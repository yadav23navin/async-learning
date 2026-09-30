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

const limit = 50;
const totalPages = Math.ceil(500000 / limit);

const seen = new Set();
let duplicates = 0;

await client.connect();

try {
    for (let page = 1; page <= totalPages; page++) {
        const offset = (page - 1) * limit;

        const result = await client.query(
            `
            SELECT id
            FROM work_items
            ORDER BY created_at DESC, id DESC
            LIMIT $1
            OFFSET $2
            `,
            [limit, offset]
        );

        for (const row of result.rows) {
            if (seen.has(row.id)) {
                duplicates++;
            }

            seen.add(row.id);
        }

        if (page % 1000 === 0) {
            console.log(
                `Processed page ${page}/${totalPages}, seen: ${seen.size}`
            );
        }
    }

    console.log("\nFinished.");
    console.log("Items seen:", seen.size);
    console.log("Duplicates:", duplicates);
} finally {
    await client.end();
}