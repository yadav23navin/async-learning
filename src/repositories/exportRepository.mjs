import esClient from "../elasticsearchClient.mjs";

const INDEX = "work_items_v2";

const createExportRepository = () => {
    const openPointInTime = async () => {
        const response = await esClient.openPointInTime({
            index: INDEX,
            keep_alive: "2m"
        });

        return response.id;
    };

    const fetchBatch = async ({
        pitId,
        query = "",
        filters = {},
        searchAfter = null,
        size = 500
    }) => {
        const filterClauses = [];

        for (const field of ["state", "assignee_id", "project_id", "priority"]) {
            if (filters[field]) {
                filterClauses.push({
                    term: { [field]: String(filters[field]) }
                });
            }
        }

        if (filters.created_from || filters.created_to) {
            const range = {};

            if (filters.created_from) {
                range.gte = Number(filters.created_from);
            }

            if (filters.created_to) {
                range.lte = Number(filters.created_to);
            }

            filterClauses.push({ range: { created_at: range } });
        }

        if (filters.label) {
            filterClauses.push({
                nested: {
                    path: "labels",
                    query: {
                        term: { "labels.name": filters.label }
                    }
                }
            });
        }

        const mustClauses = query.trim()
            ? [{
                multi_match: {
                    query: query.trim(),
                    fields: ["title^2", "description"]
                }
            }]
            : [];

        const response = await esClient.search({
            size,
            pit: {
                id: pitId,
                keep_alive: "2m"
            },
            track_total_hits: false,
            _source: [
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
            ],
            query: {
                bool: {
                    must: mustClauses,
                    filter: filterClauses
                }
            },
            sort: [
                { created_at: "asc" },
                { work_item_id: "asc" }
            ],
            ...(searchAfter ? { search_after: searchAfter } : {})
        });

        return {
            items: response.hits.hits.map(hit => hit._source),
            nextSearchAfter:
                response.hits.hits.length > 0
                    ? response.hits.hits[response.hits.hits.length - 1].sort
                    : null,
            pitId: response.pit_id ?? pitId
        };
    };

    const closePointInTime = async (pitId) => {
        await esClient.closePointInTime({ id: pitId });
    };

    return {
        openPointInTime,
        fetchBatch,
        closePointInTime
    };
};

export default createExportRepository;
