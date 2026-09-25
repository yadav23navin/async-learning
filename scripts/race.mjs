import pg from "pg";

const { Client } = pg;

//This function creates a PostgreSQL connection.
const createClient = () =>
    new Client({
        host: "localhost",
        port: 5432,
        database: "minitrack",
        user: "minitrack",
        password: "minitrack"
    });

const run = async () => {
    const clientA = createClient();
    const clientB = createClient();

    //This establishes the actual database connections.
    await clientA.connect();
    await clientB.connect();

    try {
        const workItemId = 1;

        // Both writers read the same original value
        const resultA = await clientA.query(
            `SELECT id, title, version FROM work_items WHERE id = $1`,
            [workItemId]
        );

        const resultB = await clientB.query(
            `SELECT id, title, version FROM work_items WHERE id = $1`,
            [workItemId]
        );

        // stores the value they read 
        const originalTitleA = resultA.rows[0].title;
        const originalTitleB = resultB.rows[0].title;

        console.log("Writer A read:", originalTitleA);
        console.log("Writer B read:", originalTitleB);

        // Both writers now update using the value they previously read
        // asking Node.js to start both updates concurrently.
       {/*} await Promise.all([
            clientA.query(
                `UPDATE work_items
                 SET title = $1
                 WHERE id = $2`,
                [`Writer A edit`, workItemId]
            ),

            clientB.query(
                `UPDATE work_items
                 SET title = $1
                 WHERE id = $2`,
                [`Writer B edit`, workItemId]
            )
        ]);

        // read the final row to see which edit was saved
        const finalResult = await clientA.query(
            `SELECT id, title FROM work_items WHERE id = $1`,
            [workItemId]
        );

        console.log("\nFinal row:");
        console.log(finalResult.rows[0]);

        console.log("\nWriter A edit:", "Writer A edit");
        console.log("Writer B edit:", "Writer B edit");   */}

        //compare-and-set behavior
        const updateA = clientA.query(
            `UPDATE work_items
            SET title = $1,
                version = version + 1
            WHERE id = $2
            AND version = $3
            RETURNING id, title, version`,
            ["Writer A edit", workItemId, resultA.rows[0].version]
        );

        const updateB = clientB.query(
            `UPDATE work_items
            SET title = $1,
                version = version + 1
            WHERE id = $2
            AND version = $3
            RETURNING id, title, version`,
            ["Writer B edit", workItemId, resultB.rows[0].version]
        );

        const [resultUpdateA, resultUpdateB] = await Promise.all([
            updateA,
            updateB
        ]);

        console.log("Writer A update:", resultUpdateA.rows);
        console.log("Writer B update:", resultUpdateB.rows);
        if (resultUpdateA.rowCount === 0) {
        console.log("Writer A → 409 Conflict");
        console.log("Message: This item was changed by someone else. Please refresh and try again.");
    }

    if (resultUpdateB.rowCount === 0) {
        console.log("Writer B → 409 Conflict");
        console.log("Message: This item was changed by someone else. Please refresh and try again.");
    }
        //console.log("One edit was overwritten by the other.");
        const finalResult = await clientA.query(
        `SELECT id, title, version
        FROM work_items
        WHERE id = $1`,
        [workItemId]
    );

    console.log("Final row:", finalResult.rows[0]);
    } finally {
        await clientA.end();
        await clientB.end();
    }
};

run();