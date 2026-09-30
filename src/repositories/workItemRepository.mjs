{/*//import workItemRepository from "...";
//import projectRepository from "...";

//this replace the above two lines with the following code Before, the service directly imported both repositories:Now it receives both:
const createWorkItemRepository = () => {
    const workItems = [];

    const create = (workItem) => {
        workItems.push(workItem);
        return workItem;
    };

    const findAll = () => {
        return workItems;
    };

    const findById = (id) => {
        return workItems.find((workItem) => workItem.id === id);
    };

    const update = (id, data) => {
        const workItem = workItems.find(
            (workItem) => workItem.id === id
        );

        if (!workItem) {
            return null;
        }

        Object.assign(workItem, data);

        return workItem;
    };

    const remove = (id) => {
        const index = workItems.findIndex(
            (workItem) => workItem.id === id
        );

        if (index === -1) {
            return null;
        }

        const [deletedWorkItem] = workItems.splice(index, 1);

        return deletedWorkItem;
    };

    return {
        create,
        findAll,
        findById,
        update,
        remove
    };
};

export default createWorkItemRepository; */}

import pg from "pg";
import {Buffer} from "node:buffer";
import AppError from "../AppError.mjs";

const { Client } = pg;

const encodeCursor = ({created_at, id}) => {
    return Buffer.from(JSON.stringify({created_at, id})).toString("base64url");
};

const decodeCursor =(cursor) => {
    try{
    const decoded = Buffer.from(cursor, "base64url").toString("utf-8");
    return JSON.parse(decoded);
}catch{
    throw new AppError(
        "Invalid cursor",
        400,
        "BAD_REQUEST"
    )
}
};


const createWorkItemRepository = () => {
    const createClient = () =>
        new Client({
            host: "localhost",
            port: 5432,
            database: "minitrack",
            user: "minitrack",
            password: "minitrack"
        });

    {/*const findAll = async () => {
        const client = createClient();

        await client.connect();

        try {
            const result = await client.query(`
                SELECT
                    id,
                    project_id,
                    title,
                    status,
                    priority,
                    created_at
                FROM work_items
                ORDER BY created_at DESC, id DESC
            `);

            return result.rows;
        } finally {
            await client.end();
        }
    };

    return {
        findAll
    };  */}

    // now repository will support pagination and sorting, so the service can pass page, limit, and sort parameters to the repository
    const findAll = async ({ page, limit, sort }) => {
    const client = createClient();

    await client.connect();

    try {
        const offset = (page - 1) * limit;

        const result = await client.query(
            `
            SELECT
                id,
                project_id,
                title,
                status,
                priority,
                created_at
            FROM work_items
            ORDER BY ${sort}
            LIMIT $1
            OFFSET $2
            `,
            [limit, offset]
        );

        // this will return the total number of work items in the database, 
        // so the service can calculate the total number of pages
        const countResult = await client.query(
            `
            SELECT COUNT(*) AS total
            FROM work_items
            `
        );

        return {
            rows: result.rows,                                           // this will return the rows of work items
            total: Number(countResult.rows[0].total)                     // this will return the total number of work items in the database
        };
    } finally {
        await client.end();
    }
};
const findAllCursor = async ({ cursor, limit }) => {
    const client = createClient();

    await client.connect();                                              // connect to the database

    try {
        let result;

        if (cursor) {
            const { created_at, id } = decodeCursor(cursor);

            result = await client.query(
                `
                SELECT
                    id,
                    project_id,
                    title,
                    status,
                    priority,
                    created_at::text as created_at
                FROM work_items
                WHERE (created_at, id) < ($1, $2)
                ORDER BY created_at DESC, id DESC
                LIMIT $3
                `,
                [created_at, id, limit + 1]
            );
        } else {
            result = await client.query(
                `
                SELECT
                    id,
                    project_id,
                    title,
                    status,
                    priority,
                    created_at::text as created_at
                FROM work_items
                ORDER BY created_at DESC, id DESC
                LIMIT $1
                `,
                [limit + 1]
            );
        }

        const hasMore = result.rows.length > limit;

        const rows = hasMore
            ? result.rows.slice(0, limit)
            : result.rows;

        const lastRow = rows[rows.length - 1];

        const nextCursor =
            hasMore && lastRow
                ? encodeCursor({
                      created_at: lastRow.created_at,
                      id: lastRow.id
                  })
                : null;

        return {
            rows,
            nextCursor,
            hasMore
        };
    } finally {
        await client.end();
    }
};
return {
    findAll,
    findAllCursor
};
};

export default createWorkItemRepository;