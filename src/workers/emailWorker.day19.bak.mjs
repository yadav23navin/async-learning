import amqp from "amqplib";
import nodemailer from "nodemailer";

const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost:5672";
const EXCHANGE = "work_items.events";
const DEAD_EXCHANGE = "work_items.dead";

const QUEUES = {
  "work_item.created": "work_item_created.email",
  "work_item.assigned": "work_item_assigned.email"
};

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "localhost",
  port: Number(process.env.SMTP_PORT || 1025),
  secure: false
});

async function startWorker() {
  const connection = await amqp.connect(RABBITMQ_URL);
  const channel = await connection.createChannel();

  await channel.assertExchange(EXCHANGE, "topic", {
    durable: true
  });

  await channel.assertExchange(DEAD_EXCHANGE, "direct", {
    durable: true
  });

  for (const [routingKey, queue] of Object.entries(QUEUES)) {
    await channel.assertQueue(queue, {
      durable: true,
      arguments: {
        "x-dead-letter-exchange": DEAD_EXCHANGE,
        "x-dead-letter-routing-key": `${queue}.failed`
      }
    });

    await channel.assertQueue(`${queue}.failed`, {
      durable: true
    });

    await channel.bindQueue(queue, EXCHANGE, routingKey);
    await channel.bindQueue(
      `${queue}.failed`,
      DEAD_EXCHANGE,
      `${queue}.failed`
    );
  }

  // Process one unacknowledged message at a time.
  channel.prefetch(1);

  const from = process.env.NOTIFICATION_EMAIL_FROM || "minitrack@example.test";
  const to = process.env.NOTIFICATION_EMAIL_TO || "developer@example.test";

  for (const [eventType, queue] of Object.entries(QUEUES)) {
    await channel.consume(queue, async (message) => {
      if (!message) return;

      try {
        const testDelayMs = Number(process.env.WORKER_TEST_DELAY_MS || 0);
        if (testDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, testDelayMs));
        }

        const event = JSON.parse(message.content.toString());
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

        console.log(`Email sent for ${event.eventType}; event ID: ${event.eventId}`);
        channel.ack(message);
      } catch (error) {
        console.error(`Failed to process message from ${queue}:`, error.message);

        // Reject without requeue: RabbitMQ routes it to the configured dead-letter queue.
        channel.nack(message, false, false);
      }
    }, { noAck: false });
  }

  console.log("Email worker connected. Waiting for messages...");
}

startWorker().catch((error) => {
  console.error("Email worker failed to start:", error);
  process.exitCode = 1;
});
