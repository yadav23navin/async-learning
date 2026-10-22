import amqp from "amqplib";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

const COUNT = 10_000;
const QUEUE = "day21.loadtest";
const connection = await amqp.connect(
  process.env.RABBITMQ_URL || "amqp://localhost:5672"
);
const channel = await connection.createConfirmChannel();

try {
  await channel.assertQueue(QUEUE, { durable: true });
  let peakDepth = (await channel.checkQueue(QUEUE)).messageCount;
  let failures = 0;
  const start = performance.now();

  for (let i = 0; i < COUNT; i++) {
    try {
      channel.sendToQueue(
        QUEUE,
        Buffer.from(JSON.stringify({
          eventId: randomUUID(),
          correlationId: randomUUID(),
          test: true,
          sequence: i + 1
        })),
        { persistent: true, contentType: "application/json" }
      );

      if ((i + 1) % 250 === 0) {
        await channel.waitForConfirms();
        peakDepth = Math.max(
          peakDepth,
          (await channel.checkQueue(QUEUE)).messageCount
        );
      }
    } catch {
      failures++;
    }
  }

  await channel.waitForConfirms();
  const elapsedSeconds = (performance.now() - start) / 1000;
  peakDepth = Math.max(
    peakDepth,
    (await channel.checkQueue(QUEUE)).messageCount
  );

  console.log(JSON.stringify({
    published: COUNT - failures,
    requested: COUNT,
    elapsedSeconds: Number(elapsedSeconds.toFixed(2)),
    throughputEventsPerSecond: Math.round((COUNT - failures) / elapsedSeconds),
    peakQueueDepth: peakDepth,
    publishFailures: failures,
    queue: QUEUE
  }, null, 2));
} finally {
  await channel.close();
  await connection.close();
}
