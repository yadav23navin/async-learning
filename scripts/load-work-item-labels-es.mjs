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

const loadLabels = async () => {
    await pgClient.connect();

    try {
        const result = await pgClient.query(`
            SELECT
                wil.work_item_id,
                l.id AS label_id,
                l.name
            FROM work_item_labels wil
            JOIN labels l
                ON l.id = wil.label_id
            ORDER BY wil.work_item_id
        `);

        console.log(`Loaded ${result.rows.length} label relationships.`);

        const labelsByWorkItem = new Map();

        for (const row of result.rows) {
            if (!labelsByWorkItem.has(row.work_item_id)) {
                labelsByWorkItem.set(row.work_item_id, []);
            }

            labelsByWorkItem.get(row.work_item_id).push({
                id: String(row.label_id),
                name: row.name
            });
        }

        console.log(`Work items with labels: ${labelsByWorkItem.size}`);

        for (const [workItemId, labels] of labelsByWorkItem) {
            await esClient.update({
                index: "work_items_v2",
                id: String(workItemId),
                doc: {
                    labels
                }
            });
        }

        console.log(
            `Updated ${labelsByWorkItem.size} work items in Elasticsearch.`
        );
    } finally {
        await pgClient.end();
        await esClient.close();
    }
};

loadLabels().catch((error) => {
    console.error("Label loader failed:");
    console.error(error);
    process.exitCode = 1;
});