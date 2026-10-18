/**
 * Centralized cache invalidation rules.
 *
 * Each mutation declares the entity and IDs it changed.
 * The returned keys are the cache entries that may now be stale.
 */
export function buildInvalidationSet(entity, ids = {}) {
    const keys = new Set();

    switch (entity) {
        case "workItem": {
            keys.add("http:work-items:*");
            const projectId = ids.projectId;
            const broadChange = ids.operation !== "update-title";
            if (broadChange) {
                keys.add("search:facets:v1");
                keys.add("reference:project-states:v1");
            }
            if ((ids.operation === "delete" || ids.operation === undefined || ids.assigneeChanged)
                && projectId !== undefined && projectId !== null) {
                keys.add(`reference:project-members:${projectId}:v1`);
            }
            break;
        }

        case "project": {
            const projectId = ids.projectId ?? ids.id;
            if (ids.operation === "delete") {
                keys.add("http:work-items:*");
                keys.add("search:facets:v1");
            }
            if (ids.operation === "delete" && projectId !== undefined && projectId !== null) {
                keys.add(`reference:project-members:${projectId}:v1`);
            }
            break;
        }

        case "label": {
            keys.add("reference:labels:v1");
            keys.add("search:facets:v1");
            break;
        }

        default:
            throw new Error(`Unknown cache invalidation entity: ${entity}`);
    }

    return [...keys];
}

import redisClient from "./redisClient.mjs";

/**
 * Delete exact keys and SCAN for wildcard patterns.
 * Avoids Redis KEYS, which can block Redis while scanning a large keyspace.
 */
export function createCacheInvalidator(client) {
    return async function invalidateCacheKeys(keys) {
        let deleted = 0;

        for (const pattern of keys) {
            if (!pattern.includes("*")) {
                deleted += await client.del(pattern);
                continue;
            }

            let cursor = "0";
            const matchedKeys = new Set();

            do {
                const result = await client.scan(cursor, {
                    MATCH: pattern,
                    COUNT: 100
                });

                cursor = String(result.cursor);
                for (const key of result.keys) matchedKeys.add(key);
            } while (cursor !== "0");

            const keys = [...matchedKeys];
            for (let offset = 0; offset < keys.length; offset += 500) {
                deleted += await client.del(keys.slice(offset, offset + 500));
            }
        }

        return deleted;
    };
}

export const invalidateCacheKeys = createCacheInvalidator(redisClient);
