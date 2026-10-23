import pg from "pg";

const { Client } = pg;

const createDigestRepository = ({ ClientClass = Client } = {}) => {
    const createClient = () =>
        new ClientClass({
            host: process.env.PGHOST || "localhost",
            port: Number(process.env.PGPORT || 5432),
            database: process.env.PGDATABASE || "minitrack",
            user: process.env.PGUSER || "minitrack",
            password: process.env.PGPASSWORD || "minitrack"
        });

    const createRun = async () => {
        const client = createClient();
        await client.connect();

        try {
            const result = await client.query(
                `INSERT INTO digest_job_runs (started_at)
                 VALUES (NOW())
                 RETURNING id, started_at`
            );

            return result.rows[0];
        } finally {
            await client.end();
        }
    };

    const findUsersWithDueItems = async (dueDate) => {
        const client = createClient();
        await client.connect();

        try {
            const result = await client.query(
                `SELECT
                    u.id AS user_id,
                    u.name,
                    u.email,
                    json_agg(
                        json_build_object(
                            'id', w.id,
                            'title', w.title,
                            'status', w.status,
                            'project_id', w.project_id
                        )
                        ORDER BY w.id
                    ) AS items
                 FROM users u
                 JOIN work_items w ON w.assignee_id = u.id
                 WHERE w.due_date = $1::date
                   AND w.status IN ('todo', 'in_progress')
                 GROUP BY u.id, u.name, u.email
                 ORDER BY u.id`,
                [dueDate]
            );

            return result.rows;
        } finally {
            await client.end();
        }
    };

    const finishRun = async ({
        id,
        usersProcessed,
        emailsSent,
        errors,
        status,
        errorDetails = []
    }) => {
        const client = createClient();
        await client.connect();

        try {
            await client.query(
                `UPDATE digest_job_runs
                 SET finished_at = NOW(),
                     users_processed = $2,
                     emails_sent = $3,
                     errors = $4,
                     status = $5,
                     error_details = $6::jsonb
                 WHERE id = $1`,
                [
                    id,
                    usersProcessed,
                    emailsSent,
                    errors,
                    status,
                    JSON.stringify(errorDetails)
                ]
            );
        } finally {
            await client.end();
        }
    };

    return {
        createRun,
        findUsersWithDueItems,
        finishRun
    };
};

export default createDigestRepository; 
    