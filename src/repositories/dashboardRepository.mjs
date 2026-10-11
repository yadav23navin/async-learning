
import esClient from "../elasticsearchClient.mjs";

const INDEX = "work_items_v2";

const createDashboardRepository = () => {
    const countByState = async () => {
        const response = await esClient.search({
            index: INDEX,
            size: 0,
            aggs: {
                items_by_state: {
                    terms: {
                        field: "state",
                        size: 20
                    }
                }
            }
        });

        return response.aggregations.items_by_state.buckets.map((bucket) => ({
            state: bucket.key,
            count: bucket.doc_count
        }));
    };

    // Deliberately omit size to demonstrate Elasticsearch's default of 10.
    const countByAssigneeDefault = async () => {
        const response = await esClient.search({
            index: INDEX,
            size: 0,
            aggs: {
                items_by_assignee: {
                    terms: {
                        field: "assignee_id",
                        size: 20
                    }
                }
            }
        });

        return response.aggregations.items_by_assignee.buckets.map((bucket) => ({
            assignee_id: bucket.key,
            count: bucket.doc_count
        }));
    };

const itemsCreatedPerDay = async () => {
    const response = await esClient.search({
        index: INDEX,
        size: 0,
        query: {
            range: {
                created_at: {
                    gte: "now-30d/d",
                    lte: "now",
                    time_zone: "Asia/Kolkata"
                }
            }
        },
        aggs: {
            items_per_day: {
                date_histogram: {
                    field: "created_at",
                    calendar_interval: "day",
                    time_zone: "Asia/Kolkata",
                    format: "yyyy-MM-dd",
                    min_doc_count: 0,
                    extended_bounds: {
                        min: "now-30d/d",
                        max: "now/d"
                    }
                }
            }
        }
    });

    return response.aggregations.items_per_day.buckets.map((bucket) => ({
        date: bucket.key_as_string,
        count: bucket.doc_count
    }));
};

const averagePointsByProject = async () => {
    const response = await esClient.search({
        index: INDEX,
        size: 0,
        aggs: {
            projects: {
                terms: {
                    field: "project_id",
                    size: 100
                },
                aggs: {
                    average_points: {
                        avg: {
                            field: "points"
                        }
                    }
                }
            }
        }
    });

    return response.aggregations.projects.buckets.map((bucket) => ({
        project_id: bucket.key,
        average_points: bucket.average_points.value
    }));
};
const countDistinctAssignees = async () => {
    const response = await esClient.search({
        index: INDEX,
        size: 0,
        aggs: {
            distinct_assignees: {
                cardinality: {
                    field: "assignee_id"
                }
            }
        }
    });

    return response.aggregations.distinct_assignees.value;
};

    return {
        countByState,
        countByAssigneeDefault,
        itemsCreatedPerDay,
        averagePointsByProject,
        countDistinctAssignees
    };
};

export default createDashboardRepository;