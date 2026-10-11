import pg from "pg";
import { Client as ElasticsearchClient } from "@elastic/elasticsearch";

const { Client: PostgresClient } = pg;

const pgClient = new PostgresClient({
    host: "localhost",
    port: 5432,
    database: "minitrack",
    user: "minitrack",
    password: "minitrack"
});

const esClient = new ElasticsearchClient({
    node: "http://localhost:9200",
    auth: {
        username: "elastic",
        password: process.env.ES_PASSWORD
    }
});

const INDEX = "work_items_bulk_lab";
const TARGET_COUNT = 100_000;
const BATCH_SIZE = 2_000;
const POISON_COUNT = 50;

const stats = {
    ok: 0,
    failed: 0,
    retried: 0
};

const failures = new Map();

function transform(row) {
    return {
        title: row.title,
        description: row.description ?? "",
        state: row.status,
        assignee_id:
            row.assignee_id == null ? null : String(row.assignee_id),
        project_id: String(row.project_id),
        priority: row.priority ?? undefined,
        created_at: new Date(row.created_at).getTime(),
        points: 1
    };
}

function isRetryable(status) {
    return status === 429 || status === 502 ||
        status === 503 || status === 504;
}

function errorDetails(item) {
    const operation = item.index ?? item.create ?? item.update;
    return {
        id: String(operation?._id ?? "unknown"),
        status: operation?.status,
        reason: operation?.error?.reason ?? JSON.stringify(operation?.error)
    };
}

async function submitBatch(documents) {
    const operations = [];

    for (const doc of documents) {
        operations.push({
            index: {
                _index: INDEX,
                _id: String(doc.id)
            }
        });

        operations.push(doc.body);
    }

    const response = await esClient.bulk({
        operations,
        refresh: false
    });

    // Always inspect the batch-level errors flag.
    if (!response.errors) {
        stats.ok += documents.length;
        return;
    }

    const retryDocuments = [];

    response.items.forEach((item, index) => {
        const result = item.index;
        const original = documents[index];

        if (result.error) {
            const failure = errorDetails(item);
            failures.set(failure.id, failure);

            if (isRetryable(result.status)) {
                retryDocuments.push(original);
            } else {
                stats.failed++;
            }
        } else {
            stats.ok++;
        }
    });

    // Retry retryable items once, and only once.
    if (retryDocuments.length > 0) {
        const retryOperations = [];

        for (const doc of retryDocuments) {
            retryOperations.push({
                index: { _index: INDEX, _id: String(doc.id) }
            });
            retryOperations.push(doc.body);
        }

        stats.retried += retryDocuments.length;

        const retryResponse = await esClient.bulk({
            operations: retryOperations,
            refresh: false
        });

        if (retryResponse.errors) {
            retryResponse.items.forEach((item, index) => {
                const doc = retryDocuments[index];
                const result = item.index;

                if (result.error) {
                    const failure = errorDetails(item);
                    failures.set(failure.id, failure);
                    stats.failed++;
                } else {
                    failures.delete(String(doc.id));
                    stats.ok++;
                }
            });
        } else {
            for (const doc of retryDocuments) {
                failures.delete(String(doc.id));
                stats.ok++;
            }
        }
    }
}

async function main() {
    await pgClient.connect();

    try {
        // Re-create the lab index using the same strict mapping.
        await esClient.indices.delete({
            index: INDEX,
            ignore_unavailable: true
        });

        await esClient.indices.create({
            index: INDEX,
            mappings: {
                dynamic: "strict",
                properties: {
                    title: {
                        type: "text",
                        fields: { keyword: { type: "keyword" } }
                    },
                    description: { type: "text" },
                    state: { type: "keyword" },
                    assignee_id: { type: "keyword" },
                    project_id: { type: "keyword" },
                    priority: { type: "keyword" },
                    created_at: {
                        type: "date",
                        format: "epoch_millis"
                    },
                    points: { type: "integer" },
                    due_date: {
                        type: "date",
                        format: "epoch_millis"
                    },
                    labels: {
                        type: "nested",
                        properties: {
                            id: { type: "keyword" },
                            name: { type: "keyword" }
                        }
                    }
                }
            }
        });

        let lastId = 0;
        let processed = 0;

        while (processed < TARGET_COUNT) {
            const result = await pgClient.query(
                `
                SELECT id, project_id, assignee_id, title,
                       description, status, priority, created_at
                FROM work_items
                WHERE id > $1
                ORDER BY id
                LIMIT $2
                `,
                [lastId, Math.min(BATCH_SIZE, TARGET_COUNT - processed)]
            );

            if (result.rows.length === 0) break;

            const documents = result.rows.map((row, index) => {
                const body = transform(row);

                // Deliberately poison exactly 50 documents.
                if (processed + index < POISON_COUNT) {
                    body.points = "not-an-integer";
                }

                return { id: row.id, body };
            });

            await submitBatch(documents);

            processed += result.rows.length;
            lastId = result.rows[result.rows.length - 1].id;

            console.log(`Processed ${processed}/${TARGET_COUNT}`);
        }

        await esClient.indices.refresh({ index: INDEX });

        const countResult = await esClient.count({ index: INDEX });
        const failureList = [...failures.values()];

        console.log("\n=== Bulk indexing summary ===");
        console.log(`Documents read: ${processed}`);
        console.log(`Indexed successfully: ${countResult.count}`);
        console.log(`Successful operations: ${stats.ok}`);
        console.log(`Failed operations: ${stats.failed}`);
        console.log(`Retried operations: ${stats.retried}`);
        console.log(`Failure IDs collected: ${failureList.length}`);
        console.log(`Expected poisoned failures: ${POISON_COUNT}`);

        console.log("\nFailure details:");
        console.log(JSON.stringify(failureList, null, 2));

        if (
            processed !== TARGET_COUNT ||
            countResult.count !== TARGET_COUNT - POISON_COUNT ||
            failureList.length !== POISON_COUNT
        ) {
            throw new Error("Verification failed: unexpected counts.");
        }

        console.log("\nPASS: 99,950 documents indexed; 50 poisoned documents rejected.");
    } finally {
        await pgClient.end();
        await esClient.close();
    }
}

main().catch((error) => {
    console.error("Bulk indexer failed:", error);
    process.exitCode = 1;
});