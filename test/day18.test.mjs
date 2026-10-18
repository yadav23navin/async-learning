import test from "node:test";
import assert from "node:assert/strict";
import { withLock, RELEASE_IF_OWNER } from "../src/withLock.mjs";
import { createWorkItemCreateRateLimiter } from "../src/rateLimitWorkItemCreate.mjs";
import { FakeRedis } from "./helpers/fakeRedis.mjs";

test("lock acquires, invokes once, then releases", async () => {
    const redis = new FakeRedis();
    const result = await withLock("lock:a", 1000, async () => "done", { redis });
    assert.deepEqual(result, { acquired: true, value: "done" });
    assert.equal(await redis.get("lock:a"), null);
});

test("held lock refuses a second callback", async () => {
    const redis = new FakeRedis();
    await redis.set("lock:a", "owner", { PX: 1000 });
    let called = false;
    assert.deepEqual(await withLock("lock:a", 1000, () => { called = true; }, { redis }), { acquired: false });
    assert.equal(called, false);
});

test("Redis acquisition errors reject without running callback", async () => {
    let called = false;
    const redis = { async set() { throw new Error("Redis offline"); } };
    await assert.rejects(withLock("lock:a", 1000, () => { called = true; }, { redis }), /Redis offline/);
    assert.equal(called, false);
});

test("callback failure still releases lock", async () => {
    const redis = new FakeRedis();
    await assert.rejects(withLock("lock:a", 1000, () => { throw new Error("callback failed"); }, { redis }), /callback failed/);
    assert.equal(await redis.get("lock:a"), null);
});

test("old owner cannot delete a replaced lock; release script checks token atomically", async () => {
    const redis = new FakeRedis();
    const originalEval = redis.eval.bind(redis);
    redis.eval = async (script, options) => {
        await redis.set(options.keys[0], "new-owner", { PX: 1000 });
        return originalEval(script, options);
    };
    await withLock("lock:a", 1000, () => "ok", { redis, token: "old-owner" });
    assert.equal(await redis.get("lock:a"), "new-owner");
    assert.match(RELEASE_IF_OWNER, /GET.*KEYS\[1\].*ARGV\[1\]/s);
    assert.match(RELEASE_IF_OWNER, /DEL/);
});

async function limiterApi(t) {
    void t;
    const redis = new FakeRedis();
    let time = 1_000_000, sequence = 0;
    const limiter = createWorkItemCreateRateLimiter({ redis, now: () => time, makeId: () => `r${sequence++}` });
    const run = async (user = "alice") => {
        const res = { headers: {}, statusCode: 201, set(name, value) { this.headers[name.toLowerCase()] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
        let passed = false;
        await limiter({ user: { id: user }, ip: "127.0.0.1" }, res, (error) => { if (error) throw error; passed = true; });
        return { status: res.statusCode, headers: res.headers, body: res.body, passed };
    };
    return { redis, run, setTime: (value) => { time = value; } };
}

test("allows first ten, rejects the eleventh with sensible Retry-After, and leaves reads alone", async (t) => {
    const api = await limiterApi(t);
    for (let i = 0; i < 10; i++) assert.equal((await api.run()).status, 201);
    const rejected = await api.run();
    assert.equal(rejected.status, 429);
    assert.ok(Number(rejected.headers["retry-after"]) >= 1 && Number(rejected.headers["retry-after"]) <= 60);
    // The middleware is only installed on the create route; ordinary reads never invoke it.
    const keys = [...api.redis.sortedSets.values()];
    assert.equal(keys[0].size, 10);
});

test("allows a request once an earlier request expires and isolates users", async (t) => {
    const api = await limiterApi(t);
    for (let i = 0; i < 10; i++) assert.equal((await api.run("alice")).status, 201);
    assert.equal((await api.run("bob")).status, 201);
    api.setTime(1_060_001);
    assert.equal((await api.run("alice")).status, 201);
});

test("concurrent creates never exceed ten", async (t) => {
    const api = await limiterApi(t);
    const results = await Promise.all(Array.from({ length: 30 }, () => api.run()));
    assert.equal(results.filter((result) => result.status === 201).length, 10);
    assert.equal(results.filter((result) => result.status === 429).length, 20);
});
