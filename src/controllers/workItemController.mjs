//import workItemService from "../services/workItemService.mjs";

//now the controller  receives its dependency instead of finding it itself.
const createWorkItemController = ({ workItemService }) => {
    const create = (req, res) => {
        const workItem = workItemService.create(
            Number(req.params.projectId),
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

    const findById = (req, res) => {
        const workItem = workItemService.findById(
            Number(req.params.id)
        );

        res.json({
            success: true,
            workItem
        });
    };

    const update = (req, res) => {
        const workItem = workItemService.update(
            Number(req.params.id),
            req.body
        );

        res.json({
            success: true,
            workItem
        });
    };

    const remove = (req, res) => {
        const workItem = workItemService.remove(
            Number(req.params.id)
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