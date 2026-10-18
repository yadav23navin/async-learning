import AppError from "../AppError.mjs";

//import workItemService from "../services/workItemService.mjs";

//now the controller  receives its dependency instead of finding it itself.
const createWorkItemController = ({ workItemService }) => {
    const parseId = (value, name) => {
        const id = Number(value);
        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new AppError(`${name} must be a positive integer`, 400, "BAD_REQUEST");
        }
        return id;
    };

    const create = async (req, res) => {
        const workItem = await workItemService.create(
            parseId(req.params.projectId, "projectId"),
            req.body.title
        );

        res.status(201).json({
            success: true,
            workItem
        });
    };

    {/*const findAll = async(req, res) => {
        const workItems = await workItemService.findAll();

        res.json({
            success: true,
            workItems
        });
    };   */}

    // this will now support pagination and sorting, so it can pass page, limit, and sort parameters to the service
    const findAll = async (req, res) => {
        if (Object.hasOwn(req.query, "cursor")) {
    const limit = Number(req.query.limit) || 50;

    const result = await workItemService.findAllCursor({
        cursor: req.query.cursor,
        limit
    });

    return res.json({
        data: result.rows,
        next_cursor: result.nextCursor,
        has_more: result.hasMore
    });
}
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 50;
    // this will allow sort to use an allowlist of valid sort expressions
    // (earlier sort was being inserted directly into the SQL query, which is a potential SQL injection vulnerability )
    const sortOptions = {
    created_at_desc: "created_at DESC, id DESC",
    created_at_asc: "created_at ASC, id ASC"
};
    const sort = sortOptions[req.query.sort] || "created_at DESC, id DESC";

    {/*const workItems = await workItemService.findAll({
        page,
        limit,
        sort
    });

    res.json({
        success: true,
        workItems
    });
};  */}

// this will now support pagination and sorting,
//  so it can pass page, limit, and sort parameters to the service

const result = await workItemService.findAll({
        page,
        limit,
        sort
    });

    res.json({
        data: result.rows,
        page,
        limit,
        total: result.total,
        total_pages: Math.ceil(result.total / limit)
    });
};
const findAllCursor = async (req, res) => {
    const limit = Number(req.query.limit) || 50;
    const cursor = req.query.cursor || null;

    const result = await workItemService.findAllCursor({
        cursor,
        limit
    });

    res.json({
        data: result.rows,
        next_cursor: result.nextCursor,
        has_more: result.hasMore
    });
};

    const findById = async (req, res) => {
        const workItem = await workItemService.findById(
            parseId(req.params.id, "id")
        );

        res.json({
            success: true,
            workItem
        });
    };

    const update = async (req, res) => {
        const workItem = await workItemService.update(
            parseId(req.params.id, "id"),
            req.body
        );

        res.json({
            success: true,
            workItem
        });
    };

    const remove = async (req, res) => {
        const workItem = await workItemService.remove(
            parseId(req.params.id, "id")
        );

        res.json({
            success: true,
            workItem
        });
    };

    return {
        create,
        findAll,
        findById,
        update,
        remove,
        findAllCursor

    };
};

export default createWorkItemController;
