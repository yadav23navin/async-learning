import { randomUUID } from "node:crypto";
import redisClient from "./redisClient.mjs";

const RELEASE_IF_OWNER = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

/**
 * Run fn while holding a Redis lock. ttl is milliseconds. If the lock is held,
 * returns { acquired: false }; Redis failures reject. A callback exceeding ttl
 * may overlap a later owner after expiry, so callers must keep work bounded.
 */
export async function withLock(key, ttl, fn, { redis = redisClient, token = randomUUID() } = {}) {
    if (!Number.isFinite(ttl) || ttl <= 0) throw new TypeError("ttl must be positive milliseconds");
    if (typeof fn !== "function") throw new TypeError("fn must be a function");

    const acquired = await redis.set(key, token, { NX: true, PX: ttl });
    if (acquired !== "OK") return { acquired: false };

    try {
        return { acquired: true, value: await fn() };
    } finally {
        await redis.eval(RELEASE_IF_OWNER, { keys: [key], arguments: [token] });
    }
}

export { RELEASE_IF_OWNER };
export default withLock;
