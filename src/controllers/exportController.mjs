import catchAsync from "../catchAsync.mjs";

const createExportController = ({ exportService }) => {
    const exportWorkItems = catchAsync(async (req, res) => {
        const {
            q = "",
            state,
            assignee_id,
            project_id,
            priority,
            created_from,
            created_to,
            label
        } = req.query;

        if (typeof q !== "string") {
            const error = new Error("q must be a string");
            error.statusCode = 400;
            throw error;
        }

        const filters = {
            state,
            assignee_id,
            project_id,
            priority,
            created_from,
            created_to,
            label
        };

        res.status(200);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
            "Content-Disposition",
            'attachment; filename="work-items.csv"'
        );

        await exportService.exportWorkItems({
            query: q,
            filters,
            write: res
        });

        res.end();
    });

    return { exportWorkItems };
};

export default createExportController;
