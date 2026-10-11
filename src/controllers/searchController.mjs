import catchAsync from "../catchAsync.mjs";

const createSearchController = ({ searchService }) => {
    const searchWorkItems = catchAsync(async (req, res) => {
        const {
            q = "",
            state,
            assignee_id,
            project_id,
            priority,
            created_from,
            created_to,
            label,
            size = "20",
            cursor
        } = req.query;

        let searchAfter = null;

        if (cursor) {
            try {
                searchAfter = JSON.parse(
                    Buffer.from(cursor, "base64url").toString("utf8")
                );
            } catch {
                const error = new Error("Invalid cursor encoding");
                error.statusCode = 400;
                throw error;
            }
        }

        const result = await searchService.searchWorkItems({
            query: q,
            filters: {
                state,
                assignee_id,
                project_id,
                priority,
                created_from,
                created_to,
                label
            },
            size,
            searchAfter
        });

        const nextCursor = result.nextSearchAfter
            ? Buffer.from(
                JSON.stringify(result.nextSearchAfter)
            ).toString("base64url")
            : null;

        res.status(200).json({
            success: true,
            data: {
                items: result.items,
                total: result.total,
                totalRelation: result.totalRelation,
                facets: result.facets,
                nextCursor
            }
        });
    });

    return { searchWorkItems };
};

export default createSearchController;