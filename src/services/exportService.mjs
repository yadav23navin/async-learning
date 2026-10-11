const createExportService = ({ exportRepository }) => {
    const escapeCsv = (value) => {
        if (value === null || value === undefined) {
            return "";
        }

        const text = typeof value === "object"
            ? JSON.stringify(value)
            : String(value);

        return `"${text.replace(/"/g, '""')}"`;
    };

    const columns = [
        "work_item_id",
        "title",
        "description",
        "state",
        "assignee_id",
        "project_id",
        "priority",
        "created_at",
        "due_date",
        "points",
        "labels"
    ];

    const toCsvRow = (item) =>
        columns.map(column => escapeCsv(item[column])).join(",") + "\r\n";

    const writeChunk = async (stream, chunk) => {
        if (!stream.write(chunk)) {
            await new Promise((resolve, reject) => {
                stream.once("drain", resolve);
                stream.once("error", reject);
            });
        }
    };

    const exportWorkItems = async ({
        query = "",
        filters = {},
        write
    }) => {
        let pitId = await exportRepository.openPointInTime();

        try {
            let searchAfter = null;

            await writeChunk(write, columns.join(",") + "\r\n");

            while (true) {
                const batch = await exportRepository.fetchBatch({
                    pitId,
                    query,
                    filters,
                    searchAfter,
                    size: 500
                });

                pitId = batch.pitId;

                if (batch.items.length === 0) {
                    break;
                }

                for (const item of batch.items) {
                    await writeChunk(write, toCsvRow(item));
                }

                searchAfter = batch.nextSearchAfter;
            }
        } finally {
            await exportRepository.closePointInTime(pitId);
        }
    };

    return { exportWorkItems };
};

export default createExportService;
