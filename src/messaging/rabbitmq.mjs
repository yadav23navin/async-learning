import amqp from "amqplib";

const EXCHANGE = "work_items.events";

const QUEUES = {
    "work_item.created": "work_item_created.email",
    "work_item.assigned": "work_item_assigned.email"
};

const createRabbitPublisher = ({
    url = process.env.RABBITMQ_URL || "amqp://localhost:5672"
} = {}) => {
    let connection;
    let channel;

    const connect = async () => {
        if (channel) return;

        connection = await amqp.connect(url);
        channel = await connection.createConfirmChannel();

        await channel.assertExchange(EXCHANGE, "topic", {
            durable: true
        });

        const deadExchange = "work_items.dead";

        await channel.assertExchange(deadExchange, "direct", {
            durable: true
        });

        for (const [routingKey, queue] of Object.entries(QUEUES)) {
            await channel.assertQueue(queue, {
                durable: true,
                arguments: {
                    "x-dead-letter-exchange": deadExchange,
                    "x-dead-letter-routing-key": queue + ".failed"
                }
            });

            await channel.assertQueue(queue + ".failed", {
                durable: true
            });

            await channel.bindQueue(queue, EXCHANGE, routingKey);
            await channel.bindQueue(
                queue + ".failed",
                deadExchange,
                queue + ".failed"
            );

            // Exponential backoff: 2 seconds, then 4 seconds.
            for (const [retryNumber, delayMs] of [[1, 2000], [2, 4000]]) {
                const retryQueue = `${queue}.retry.${retryNumber}`;

                await channel.assertQueue(retryQueue, {
                    durable: true,
                    arguments: {
                        "x-message-ttl": delayMs,
                        "x-dead-letter-exchange": EXCHANGE,
                        "x-dead-letter-routing-key": routingKey
                    }
                });
            }
        }

        connection.on("error", (error) => {
            console.error("RabbitMQ connection error:", error.message);
        });

        connection.on("close", () => {
            channel = undefined;
            console.error("RabbitMQ connection closed");
        });

        console.log("RabbitMQ publisher connected");
    };

    const publish = async (eventType, payload) => {
        if (!channel) {
            throw new Error("RabbitMQ publisher is not connected");
        }

        if (!Object.hasOwn(QUEUES, eventType)) {
            throw new Error(`Unsupported event type: ${eventType}`);
        }

        const eventId = crypto.randomUUID();

        channel.publish(
            EXCHANGE,
            eventType,
            Buffer.from(JSON.stringify({
                eventId,
                eventType,
                occurredAt: new Date().toISOString(),
                data: payload
            })),
            {
                persistent: true,
                contentType: "application/json",
                messageId: eventId,
                timestamp: Date.now()
            }
        );

        await channel.waitForConfirms();
    };

    const close = async () => {
        channel = undefined;

        if (connection) {
            await connection.close();
            connection = undefined;
        }
    };

    return { connect, publish, close };
};

export default createRabbitPublisher;
