import esClient from "../elasticsearchClient.mjs";
import { getOrSetCache } from "../cache.mjs";

const INDEX = "work_items_current";

const createSearchRepository = () => {
    const getProjectStates = async () =>
        getOrSetCache("reference:project-states:v1", async () => {
            const response = await esClient.search({
                index: INDEX,
                size: 0,
                aggs: {
                    states: {
                        terms: { field: "status", size: 20 }
                    }
                }
            });

            return response.aggregations.states.buckets.map(
                ({ key, doc_count }) => ({ value: key, count: doc_count })
            );
        });

    const getLabels = async () =>
        getOrSetCache("reference:labels:v1", async () => {
            const response = await esClient.search({
                index: INDEX,
                size: 0,
                aggs: {
                    labels: {
                        nested: { path: "labels" },
                        aggs: {
                            names: {
                                terms: { field: "labels.name", size: 100 }
                            }
                        }
                    }
                }
            });

            return response.aggregations.labels.names.buckets.map(
                ({ key, doc_count }) => ({ value: key, count: doc_count })
            );
        });

    const getProjectMembers = async (projectId) => {
        if (!projectId) {
            throw new Error("projectId is required");
        }

        return getOrSetCache(
            `reference:project-members:${projectId}:v1`,
            async () => {
                const response = await esClient.search({
                    index: INDEX,
                    size: 0,
                    query: {
                        term: { project_id: String(projectId) }
                    },
                    aggs: {
                        members: {
                            terms: { field: "assignee_id.keyword", size: 100 }
                        }
                    }
                });

                return response.aggregations.members.buckets.map(
                    ({ key, doc_count }) => ({ value: key, count: doc_count })
                );
            }
        );
    };

    const getSearchFacets = async () =>
        getOrSetCache("search:facets:v1", async () => {
            const response = await esClient.search({
                index: INDEX,
                size: 0,
                aggs: {
                    states: { terms: { field: "status", size: 20 } },
                    priorities: { terms: { field: "priority.keyword", size: 20 } },
                    projects: { terms: { field: "project_id.keyword", size: 100 } },
                    assignees: { terms: { field: "assignee_id.keyword", size: 100 } }
                }
            });

            const aggregations = response.aggregations;

            return {
                states: aggregations.states.buckets.map(
                    ({ key, doc_count }) => ({ value: key, count: doc_count })
                ),
                priorities: aggregations.priorities.buckets.map(
                    ({ key, doc_count }) => ({ value: key, count: doc_count })
                ),
                projects: aggregations.projects.buckets.map(
                    ({ key, doc_count }) => ({ value: key, count: doc_count })
                ),
                assignees: aggregations.assignees.buckets.map(
                    ({ key, doc_count }) => ({ value: key, count: doc_count })
                )
            };
        });

    const search = async ({
        query = "",
        filters = {},
        size = 20,
        searchAfter = null
    }) => {
        const filterClauses = [];

        if (filters.state) {
            filterClauses.push({ term: { status: filters.state } });
        }
        if (filters.assignee_id) {
            filterClauses.push({
                term: { assignee_id: String(filters.assignee_id) }
            });
        }
        if (filters.project_id) {
            filterClauses.push({
                term: { project_id: String(filters.project_id) }
            });
        }
        if (filters.priority) {
            filterClauses.push({ term: { "priority.keyword": filters.priority } });
        }

        if (filters.created_from || filters.created_to) {
            const range = {};
            if (filters.created_from) range.gte = Number(filters.created_from);
            if (filters.created_to) range.lte = Number(filters.created_to);
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
console.log("SEARCH QUERY RECEIVED:", JSON.stringify(query));
        const mustClauses = query.trim()
            ? [{
                multi_match: {
                    query: query.trim(),
                    fields: ["title^2", "description"]
                }
            }]
            : [];

        const [facets, response] = await Promise.all([
            getSearchFacets(),
            esClient.search({
                index: INDEX,
                size,
                track_total_hits: true,
                _source: [
                    "id",
                    "title",
                    "description",
                    "status",
                    "assignee_id",
                    "project_id",
                    "priority",
                    "created_at"
                ],
                query: {
                    bool: {
                        must: mustClauses,
                        filter: filterClauses
                    }
                },
                sort: [
                    { created_at: "asc" },
                    { "id.keyword": "asc" }
                ],
                ...(searchAfter ? { search_after: searchAfter } : {})
            })
        ]);

        const hits = response.hits.hits;
        const total = response.hits.total;

        return {
            items: hits.map((hit) => ({
                ...hit._source,
                _score: hit._score
            })),
            total: total.value,
            totalRelation: total.relation,
            facets,
            nextSearchAfter: hits.length === size
                ? hits[hits.length - 1].sort
                : null
        };
    };

    return {
        search,
        getProjectStates,
        getLabels,
        getProjectMembers
    };
};

export default createSearchRepository;
