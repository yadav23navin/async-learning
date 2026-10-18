import { performance } from "node:perf_hooks";
import { createClient } from "redis";

const baseUrl = process.env.STAMPEDE_URL || "http://localhost:3000/work-items?page=1&limit=50";
const requestCount = 200;
const requestUrl = new URL(baseUrl);
if (requestUrl.pathname !== "/work-items") {
    throw new Error("STAMPEDE_URL must target GET /work-items");
}
const metricsUrl = new URL("/__bench/backend-calls", requestUrl.origin);
const cacheKey = `http:work-items:v1:${requestUrl.pathname}${requestUrl.search}`;
const lockKey = `lock:${cacheKey}`;
const redis = createClient({
    url: process.env.REDIS_URL || "redis://localhost:6379",
    socket: { reconnectStrategy: false }
});
redis.on("error", (error) => console.error(`Redis error: ${error.message}`));

async function readMetrics() {
    const response = await fetch(metricsUrl);
    if (!response.ok) throw new Error(`Metrics endpoint returned HTTP ${response.status}`);
    return response.json();
}

async function resetMetrics() {
    const response = await fetch(new URL(`${metricsUrl.pathname}/reset`, metricsUrl.origin), { method: "POST" });
    if (!response.ok) throw new Error(`Metrics reset returned HTTP ${response.status}`);
}

async function runRound(label, locking) {
    await redis.del(cacheKey, lockKey);
    await resetMetrics();
    let successful = 0;
    let failed = 0;
    const errors = [];
    const started = performance.now();

    await Promise.all(Array.from({ length: requestCount }, async (_, index) => {
        try {
            const response = await fetch(baseUrl, {
                headers: locking ? {} : { "x-stampede-mode": "baseline" },
                signal: AbortSignal.timeout(45_000)
            });
            const body = await response.text();
            if (response.ok) successful += 1;
            else {
                failed += 1;
                if (errors.length < 10) errors.push(`request ${index + 1}: HTTP ${response.status}: ${body.slice(0, 250)}`);
            }
        } catch (error) {
            failed += 1;
            if (errors.length < 10) errors.push(`request ${index + 1}: ${error.message}`);
        }
    }));

    const metrics = await readMetrics();
    return {
        mode: label,
        requests: requestCount,
        backendCalls: metrics.workItemListFetches,
        successes: successful,
        failures: failed,
        elapsedMs: Number((performance.now() - started).toFixed(1)),
        errors
    };
}

let saved = {};
try {
    await redis.connect();
    const [cachedValue, cacheTtl, lockValue, lockTtl] = await Promise.all([
        redis.get(cacheKey), redis.pTTL(cacheKey), redis.get(lockKey), redis.pTTL(lockKey)
    ]);
    saved = { cachedValue, cacheTtl, lockValue, lockTtl };

    // Fail early if this server was not started with its development-only metrics route.
    await readMetrics();
    const before = await runRound("Lock disabled", false);
    const after = await runRound("Lock enabled", true);
    console.table([before, after].map(({ errors, ...summary }) => summary));
    for (const result of [before, after]) {
        if (result.errors.length) console.error(`${result.mode} errors:\n${result.errors.join("\n")}`);
    }

    const valid = before.successes + before.failures === requestCount
        && after.successes === requestCount && after.failures === 0
        && before.backendCalls > 1 && after.backendCalls === 1;
    if (!valid) {
        console.error("Stampede benchmark assertions failed: expected all 200 requests to complete, multiple unlocked backend calls, and exactly one locked backend call with 200 successful responses.");
        process.exitCode = 1;
    }
} catch (error) {
    console.error(`Stampede benchmark could not complete: ${error.message}`);
    process.exitCode = 1;
} finally {
    if (redis.isOpen) {
        try {
            await redis.del(cacheKey, lockKey);
            if (saved.cachedValue !== null && saved.cacheTtl !== -2) {
                if (saved.cacheTtl === -1) await redis.set(cacheKey, saved.cachedValue);
                else if (saved.cacheTtl > 0) await redis.set(cacheKey, saved.cachedValue, { PX: saved.cacheTtl });
            }
            if (saved.lockValue !== null && saved.lockTtl !== -2) {
                if (saved.lockTtl === -1) await redis.set(lockKey, saved.lockValue);
                else if (saved.lockTtl > 0) await redis.set(lockKey, saved.lockValue, { PX: saved.lockTtl });
            }
        } catch (error) {
            console.error(`Could not restore prior Redis state: ${error.message}`);
            process.exitCode = 1;
        }
        await redis.quit();
    }
}
