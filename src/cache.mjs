import redisClient from "./redisClient.mjs";

const DEFAULT_TTL_SECONDS = 300;
const LOCK_TTL_MS = 30_000;
const WAIT_TIMEOUT_MS = 30_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createCache(client, {
    lockTtlMs = LOCK_TTL_MS,
    waitTimeoutMs = WAIT_TIMEOUT_MS,
    pollIntervalMs = 20,
    logger = console
} = {}) {
    async function getOrSetCache(key, fetchData, ttlSeconds = DEFAULT_TTL_SECONDS, { stampedeProtection = true } = {}) {
        try {
            const cached = await client.get(key);
            if (cached !== null) return JSON.parse(cached);
        } catch (error) {
            logger.error(`[CACHE READ ERROR] ${key}: ${error.message}`);
            // Redis is an optimization. If it cannot be reached, perform exactly
            // one backend read and let its own error propagate.
            return fetchData();
        }

        if (!stampedeProtection) {
            const data = await fetchData();
            if (data !== null && data !== undefined) {
                try {
                    await client.set(key, JSON.stringify(data), { EX: ttlSeconds });
                } catch (error) {
                    logger.error(`[CACHE WRITE ERROR] ${key}: ${error.message}`);
                }
            }
            return data;
        }

        const lockKey = `lock:${key}`;
        const token = `${process.pid}:${Date.now()}:${Math.random()}`;
        const deadline = Date.now() + waitTimeoutMs;

        while (Date.now() < deadline) {
            let cached;
            let acquired;
            try {
                cached = await client.get(key);
                if (cached !== null) return JSON.parse(cached);
                acquired = await client.set(lockKey, token, { NX: true, PX: lockTtlMs });
            } catch (error) {
                logger.error(`[CACHE LOCK ERROR] ${key}: ${error.message}`);
                return fetchData();
            }

            if (acquired === "OK") {
                try {
                    const data = await fetchData();
                    if (data !== null && data !== undefined) {
                        try {
                            await client.set(key, JSON.stringify(data), { EX: ttlSeconds });
                        } catch (error) {
                            logger.error(`[CACHE WRITE ERROR] ${key}: ${error.message}`);
                        }
                    }
                    return data;
                } finally {
                    try {
                        await client.eval(
                            "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
                            { keys: [lockKey], arguments: [token] }
                        );
                    } catch (error) {
                        logger.error(`[CACHE LOCK RELEASE ERROR] ${lockKey}: ${error.message}`);
                    }
                }
            }

            await sleep(pollIntervalMs);
        }

        // A lock may be abandoned or its owner may be unusually slow. The
        // bounded fallback prevents a hanging request; backend failure is not cached.
        return fetchData();
    }

    return { getOrSetCache };
}

const { getOrSetCache } = createCache(redisClient);
export { getOrSetCache };
export default getOrSetCache;
