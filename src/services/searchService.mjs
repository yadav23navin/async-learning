const createSearchService = ({ searchRepository }) => {
    const searchWorkItems = async ({
        query = "",
        filters = {},
        size = 20,
        searchAfter = null
    }) => {
        if (typeof query !== "string") {
            const error = new Error("query must be a string");
            error.statusCode = 400;
            throw error;
        }

        const parsedSize = Number(size);

        if (
            !Number.isInteger(parsedSize) ||
            parsedSize < 1 ||
            parsedSize > 100
        ) {
            const error = new Error("size must be an integer between 1 and 100");
            error.statusCode = 400;
            throw error;
        }

        if (
            searchAfter !== null &&
            (
                !Array.isArray(searchAfter) ||
                searchAfter.length !== 2 ||
                !Number.isFinite(searchAfter[0]) ||
                typeof searchAfter[1] !== "string"
            )
        ) {
            const error = new Error("Invalid search_after cursor");
            error.statusCode = 400;
            throw error;
        }

        return searchRepository.search({
            query,
            filters,
            size: parsedSize,
            searchAfter
        });
    };

    return { searchWorkItems };
};

export default createSearchService;
