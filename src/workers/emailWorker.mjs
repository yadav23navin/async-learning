import amqp from "amqplib";
import nodemailer from "nodemailer";
import { createClient } from "redis";

const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost:5672";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const EXCHANGE = "work_items.events";
const DEAD_EXCHANGE = "work_items.dead";
const RETRY_DELAYS = [2000, 4000];
const MAX_ATTEMPTS = 3;

const QUEUES = {
  "work_item.created": "work_item_created.email",
  "work_item.assigned": "work_item_assigned.email"
};

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "localhost",
  port: Number(process.env.SMTP_PORT || 1025),
  secure: false
});

const redis = createClient({ url: REDIS_URL });
redis.on("error", (error) => {
  console.error("Redis error:", error.message);
});

async function startWorker() {
  await redis.connect();

  const connection = await amqp.connect(RABBITMQ_URL);
  const channel = await connection.createConfirmChannel();

  await channel.assertExchange(EXCHANGE, "topic", { durable: true });
  await channel.assertExchange(DEAD_EXCHANGE, "direct", { durable: true });

  for (const [eventType, queue] of Object.entries(QUEUES)) {
    await channel.assertQueue(queue, {
      durable: true,
      arguments: {
        "x-dead-letter-exchange": DEAD_EXCHANGE,
        "x-dead-letter-routing-key": `${queue}.failed`
      }
    });

    await channel.assertQueue(`${queue}.failed`, { durable: true });
    await channel.bindQueue(queue, EXCHANGE, eventType);
    await channel.bindQueue(
      `${queue}.failed`,
      DEAD_EXCHANGE,
      `${queue}.failed`
    );

    for (const [index, delayMs] of RETRY_DELAYS.entries()) {
      await channel.assertQueue(`${queue}.retry.${index + 1}`, {
        durable: true,
        arguments: {
          "x-message-ttl": delayMs,
          "x-dead-letter-exchange": EXCHANGE,
          "x-dead-letter-routing-key": eventType
        }
      });
    }
  }

  channel.prefetch(1);

  const from = process.env.NOTIFICATION_EMAIL_FROM || "minitrack@example.test";
  const to = process.env.NOTIFICATION_EMAIL_TO || "developer@example.test";

  for (const [eventType, queue] of Object.entries(QUEUES)) {
    await channel.consume(queue, async (message) => {
      if (!message) return;

      let event;
      let lockKey;

      const retryCount = Number(message.properties.headers?.["x-retry-count"] || 0);
      const attempt = retryCount + 1;

      try {
        event = JSON.parse(message.content.toString());

        if (!event.eventId) {
          throw new Error("Message has no eventId; refusing unsafe processing");
        }

        const sentKey = `email:sent:${event.eventId}`;
        lockKey = `email:processing:${event.eventId}`;

        if (await redis.exists(sentKey)) {
          console.log(`Duplicate suppressed; event ID: ${event.eventId}`);
          channel.ack(message);
          return;
        }

        const lock = await redis.set(lockKey, "1", { NX: true, EX: 60 });
        if (!lock) {
          console.log(`Processing lock exists; requeueing event ID: ${event.eventId}`);
          channel.nack(message, false, true);
          return;
        }

        console.log(
          `Processing ${event.eventType}; event ID: ${event.eventId}; attempt ${attempt}/${MAX_ATTEMPTS}`
        );

        if (process.env.WORKER_ALWAYS_FAIL === "1") {
          throw new Error("Forced transient failure for Day 20 retry test");
        }

        if (process.env.WORKER_ALWAYS_PERMANENT_FAIL === "1") {
          const error = new Error("Forced permanent failure for Day 20 test");
          error.permanent = true;
          throw error;
        }

        const data = event.data;
        let subject;
        let text;

        if (eventType === "work_item.created") {
          subject = `Work item created: ${data.title}`;
          text = `A work item was created.\n\nWork item ID: ${data.work_item_id}\nProject ID: ${data.project_id}\nTitle: ${data.title}`;
        } else {
          subject = `Work item assigned: ${data.title}`;
          text = `A work item was assigned.\n\nWork item ID: ${data.work_item_id}\nProject ID: ${data.project_id}\nTitle: ${data.title}\nAssignee ID: ${data.assignee_id}`;
        }

        await transporter.sendMail({ from, to, subject, text });

        // Store completion before ACK so a broker redelivery is suppressed.
        await redis.set(sentKey, "1", { EX: 60 * 60 * 24 * 7 });
        await redis.del(lockKey);

        console.log(`Email sent; event ID: ${event.eventId}; attempt ${attempt}`);
        channel.ack(message);
      } catch (error) {
        console.error(
          `Attempt ${attempt}/${MAX_ATTEMPTS} failed for ${event?.eventId || "unknown event"}: ${error.message}`
        );

        if (lockKey) await redis.del(lockKey).catch(() => {});

        // Decision point: permanent failures go straight to the DLQ.
        // Transient failures retry with backoff, up to three total attempts.
        const isPermanentFailure = error.permanent === true || !event;

        console.error(
          `Failure classification: ${isPermanentFailure ? "PERMANENT" : "TRANSIENT"}`
        );

        if (!isPermanentFailure && attempt < MAX_ATTEMPTS && event) {
          const nextRetry = attempt;
          const retryQueue = `${queue}.retry.${nextRetry}`;
          const delayMs = RETRY_DELAYS[nextRetry - 1];

          try {
            channel.sendToQueue(retryQueue, message.content, {
              persistent: true,
              contentType: message.properties.contentType || "application/json",
              messageId: event.eventId,
              timestamp: Date.now(),
              headers: {
                ...(message.properties.headers || {}),
                "x-retry-count": nextRetry
              }
            });

            await channel.waitForConfirms();
            console.log(
              `Retry scheduled; event ID: ${event.eventId}; next attempt ${attempt + 1}; delay ${delayMs}ms`
            );
            channel.ack(message);
          } catch (publishError) {
            console.error("Could not publish retry:", publishError.message);
            channel.nack(message, false, true);
          }
        } else {
          console.error(`Sending to DLQ after ${attempt} attempts`);
          channel.nack(message, false, false);
        }
      }
    }, { noAck: false });
  }

  const monitoredQueues = Object.values(QUEUES).flatMap((queue) => [
    queue,
    `${queue}.retry.1`,
    `${queue}.retry.2`,
    `${queue}.failed`
  ]);

  async function logQueueDepths() {
    for (const queueName of monitoredQueues) {
      const counts = await channel.checkQueue(queueName);
      const label = queueName.endsWith(".failed") ? "dlq-depth" : "queue-depth";
      console.log(`[${label}] ${queueName}: ready=${counts.messageCount}`);
    }
  }

  await logQueueDepths();

  setInterval(() => {
    logQueueDepths().catch((error) => {
      console.error("Could not log queue depths:", error.message);
    });
  }, 15000).unref();

  console.log("Email worker connected to RabbitMQ and Redis. Waiting for messages...");
}

startWorker().catch((error) => {
  console.error("Email worker failed to start:", error);
  process.exitCode = 1;
});
