import { getOrSetCache } from "./cache.mjs";

const TTL_SECONDS = 60;

export function createCacheWorkItemsResponse(cacheGetOrSet) {
    const allowBenchmarkBypass = process.env.NODE_ENV !== "production";
    return async function cacheWorkItemsResponse(req, res, next) {
        if (req.method !== "GET" || req.path !== "/work-items") return next();

        const key = `http:work-items:v1:${req.originalUrl}`;
        let downstreamFetch = false;
        let releaseResponse;
        const responseReady = new Promise((resolve) => { releaseResponse = resolve; });
        const originalJson = res.json.bind(res);
        let sent = false;

        res.json = (body) => {
            if (sent) return res;
            sent = true;
            res.setHeader("X-Cache", downstreamFetch ? "MISS" : "HIT");
            releaseResponse({ body, cacheable: res.statusCode >= 200 && res.statusCode < 300 });
            return originalJson(body);
        };

        try {
            const body = await cacheGetOrSet(key, async () => {
                downstreamFetch = true;
                next();
                const result = await responseReady;
                return result.cacheable ? result.body : undefined;
            }, TTL_SECONDS, {
                stampedeProtection: !(allowBenchmarkBypass && req.get("x-stampede-mode") === "baseline")
            });

            if (!sent) res.status(200).json(body);
        } catch (error) {
            next(error);
        }
    };
}

export default createCacheWorkItemsResponse(getOrSetCache);
