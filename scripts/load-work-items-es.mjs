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
        password: "ePS5j28X"
    }
});

const BATCH_SIZE = 5000;
const loadWorkItems = async () => {
    await pgClient.connect();
    try {
        console.log("Loading work items into Elasticsearch...");

        let lastId = 0;
        let total = 0;
        while (true) {
            const result = await pgClient.query(
                `
                SELECT
                    id,
                    project_id,
                    assignee_id,
                    title,
                    description,
                    status,
                    priority,
                    created_at,
                    updated_at,
                    version
                FROM work_items
                WHERE id > $1
                ORDER BY id
                LIMIT $2
                `,
                [lastId, BATCH_SIZE]
            );

            if (result.rows.length === 0) {
                break;
            }

            const operations = [];
            for (const workItem of result.rows) {
                operations.push({
                    index: {
                        _index: "work_items",
                        _id: workItem.id
                    }
                });

                operations.push(workItem);
            }

            const response = await esClient.bulk({
                operations,
                refresh: false
            });

            if (response.errors) {
                const failedItems = response.items.filter(
                    (item) => item.index?.error
                );

                console.error("Bulk insert errors:", failedItems.slice(0, 5));

                throw new Error(
                    `Bulk insert failed for ${failedItems.length} items`
                );
            }

            total += result.rows.length;
            lastId = result.rows[result.rows.length - 1].id;

            console.log(`Indexed ${total} work items...`);
        }

        console.log("");
        console.log(`Finished. Indexed ${total} work items.`);
    } finally {
        await pgClient.end();
        await esClient.close();
    }
};

loadWorkItems().catch((error) => {
    console.error("Loader failed:");
    console.error(error);
    process.exitCode = 1;
});