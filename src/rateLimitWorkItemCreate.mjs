import { randomUUID } from "node:crypto";
import AppError from "./AppError.mjs";
import redisClient from "./redisClient.mjs";

const LIMIT = 10;
const WINDOW_MS = 60_000;
const SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry = math.max(1, math.ceil((tonumber(oldest[2]) + window - now) / 1000))
  redis.call('PEXPIRE', key, math.max(1, tonumber(oldest[2]) + window - now))
  return {0, retry}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return {1, 0}
`;

export function createWorkItemCreateRateLimiter({ redis = redisClient, now = Date.now, makeId = randomUUID } = {}) {
    return async (req, res, next) => {
        try {
            // Authentication is not currently installed. Prefer a trusted auth
            // identity if added upstream; otherwise scope by Express's client IP.
            const identity = req.user?.id != null ? `user:${req.user.id}` : `ip:${req.ip}`;
            const result = await redis.eval(SCRIPT, {
                keys: [`rate-limit:work-item-create:${identity}`],
                arguments: [String(now()), String(WINDOW_MS), String(LIMIT), String(makeId())]
            });
            if (Number(result[0]) === 0) {
                res.set("Retry-After", String(Number(result[1])));
                return res.status(429).json({
                    success: false,
                    errorCode: "RATE_LIMITED",
                    message: "Too many work-item creation requests. Try again later."
                });
            }
            return next();
        } catch (error) {
            return next(new AppError("Rate limiter is unavailable", 503, "INTERNAL_ERROR"));
        }
    };
}

export { SCRIPT as WORK_ITEM_RATE_LIMIT_SCRIPT, LIMIT as WORK_ITEM_CREATE_LIMIT, WINDOW_MS as WORK_ITEM_CREATE_WINDOW_MS };
export default createWorkItemCreateRateLimiter;
