import pg from "pg";

const { Client } = pg;

const createClient = () =>
    new Client({
        host: "localhost",
        port: 5432,
        database: "minitrack",
        user: "minitrack",
        password: "minitrack"
    });

const client = createClient();

await client.connect();

try {
    for (let i = 1; i <= 100; i++) {
        await client.query(
            `
            INSERT INTO work_items (
                project_id,
                title,
                status,
                priority,
                created_at,
                updated_at
            )
            VALUES ($1, $2, $3, $4, NOW(), NOW())
            `,
            [
                1,
                `Concurrent insert ${i}`,
                "todo",
                "medium"
            ]
        );

        console.log(`Inserted row ${i}/100`);

        // Give the pagination script time to move between pages.
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
} finally {
    await client.end();
}