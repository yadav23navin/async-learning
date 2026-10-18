import pg from "pg";

const { Client } = pg;

const createProjectRepository = ({ ClientClass = Client } = {}) => {
    const createClient = () => new ClientClass({
        host: process.env.PGHOST || "localhost",
        port: Number(process.env.PGPORT || 5432),
        database: process.env.PGDATABASE || "minitrack",
        user: process.env.PGUSER || "minitrack",
        password: process.env.PGPASSWORD || "minitrack"
    });

    const withClient = async (operation) => {
        const client = createClient();
        await client.connect();
        try {
            return await operation(client);
        } finally {
            await client.end();
        }
    };

    const create = (project) => withClient(async (client) => {
        // organization_id is required by the database. Use an explicitly supplied
        // organization when present, otherwise the first configured organization.
        const result = await client.query(
            `INSERT INTO projects (organization_id, name)
             SELECT COALESCE($1, (SELECT id FROM organizations ORDER BY id LIMIT 1)), $2
             WHERE COALESCE($1, (SELECT id FROM organizations ORDER BY id LIMIT 1)) IS NOT NULL
             RETURNING id, organization_id, name, description, status, created_at`,
            [project.organization_id ?? project.organizationId ?? null, project.name]
        );
        if (!result.rows[0]) {
            throw new Error("Cannot create project: no organization exists");
        }
        return result.rows[0];
    });

    const findAll = () => withClient(async (client) => {
        const result = await client.query(
            `SELECT id, organization_id, name, description, status, created_at
             FROM projects ORDER BY id`
        );
        return result.rows;
    });

    const findById = (id) => withClient(async (client) => {
        const result = await client.query(
            `SELECT id, organization_id, name, description, status, created_at
             FROM projects WHERE id = $1`,
            [id]
        );
        return result.rows[0] ?? null;
    });

    const update = (id, data) => withClient(async (client) => {
        const result = await client.query(
            `UPDATE projects SET name = $1 WHERE id = $2
             RETURNING id, organization_id, name, description, status, created_at`,
            [data.name, id]
        );
        return result.rows[0] ?? null;
    });

    const remove = (id) => withClient(async (client) => {
        const result = await client.query(
            `DELETE FROM projects WHERE id = $1
             RETURNING id, organization_id, name, description, status, created_at`,
            [id]
        );
        return result.rows[0] ?? null;
    });

    return { create, findAll, findById, update, remove };
};

export default createProjectRepository;
