import pg from "pg";

const { Client } = pg;

const client = new Client({
    host: "localhost",
    port: 5432,
    database: "minitrack",
    user: "minitrack",
    password: "minitrack"
});

const run = async () => {
    await client.connect();                                          // connect node.js to postgres database using the pg library. 
    try {
        const start = performance.now();

        const workItemsResult = await client.query(`
            SELECT id, project_id, title, status, created_at
            FROM work_items
            WHERE project_id = 1
              AND status = 'todo'
            ORDER BY created_at DESC
            LIMIT 50
        `);

        const workItems = workItemsResult.rows;

       {/*} for (const workItem of workItems) {
            await client.query(`
                SELECT l.id, l.name
                FROM labels l
                JOIN work_item_labels wil
                    ON wil.label_id = l.id
                WHERE wil.work_item_id = $1
            `, [workItem.id]);
        }  */}

        //batch query to fetch labels for all work items in a single query, avoiding the N+1 problem
          const workItemIds = workItems.map((workItem) => workItem.id);

            await client.query(`
                SELECT wil.work_item_id, l.id, l.name
                FROM work_item_labels wil
                JOIN labels l
                    ON l.id = wil.label_id
                WHERE wil.work_item_id = ANY($1::bigint[])
            `, [workItemIds]);

        const end = performance.now();

        console.log(`Work items fetched: ${workItems.length}`);
        console.log(`N+1 total time: ${(end - start).toFixed(3)} ms`);
    } finally {
        await client.end();
    }
};

run();