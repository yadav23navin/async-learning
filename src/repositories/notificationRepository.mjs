import pg from "pg";

const { Client } = pg;

const createNotificationRepository = ({
    ClientClass = Client
} = {}) => {
    const createClient = () =>
        new ClientClass({
            host: process.env.PGHOST || "localhost",
            port: Number(process.env.PGPORT || 5432),
            database: process.env.PGDATABASE || "minitrack",
            user: process.env.PGUSER || "minitrack",
            password: process.env.PGPASSWORD || "minitrack"
        });

    const findRecipientById = async (userId) => {
        const client = createClient();
        await client.connect();

        try {
            const result = await client.query(
                `SELECT id, name, email
                 FROM users
                 WHERE id = $1`,
                [userId]
            );

            return result.rows[0] ?? null;
        } finally {
            await client.end();
        }
    };

    const getAssignmentEmailPreference = async (userId) => {
        const client = createClient();
        await client.connect();

        try {
            const result = await client.query(
                `SELECT assignment_email_enabled
                 FROM user_notification_preferences
                 WHERE user_id = $1`,
                [userId]
            );

            // No preference row means email notifications are enabled.
            return result.rows[0]?.assignment_email_enabled ?? true;
        } finally {
            await client.end();
        }
    };

    const recordAssignmentActivity = async ({
        projectId,
        workItemId,
        userId,
        assigneeId,
        eventId,
        correlationId
    }) => {
        const client = createClient();
        await client.connect();

        try {
            await client.query(
                `INSERT INTO activities (
                    project_id,
                    work_item_id,
                    user_id,
                    action,
                    metadata
                )
                SELECT $1, $2, $3, 'assigned', $4::jsonb
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM activities
                    WHERE action = 'assigned'
                      AND metadata->>'event_id' = $5
                )`,
                [
                    projectId,
                    workItemId,
                    userId,
                    JSON.stringify({
                        assignee_id: assigneeId,
                        event_id: eventId,
                        correlation_id: correlationId
                    }),
                    eventId
                ]
            );
        } finally {
            await client.end();
        }
    };

    return {
        findRecipientById,
        getAssignmentEmailPreference,
        recordAssignmentActivity
    };
};

export default createNotificationRepository;
