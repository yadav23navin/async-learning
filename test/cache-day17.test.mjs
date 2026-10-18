import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createCacheWorkItemsResponse } from "../src/cacheWorkItemsResponse.mjs";
import { createCache } from "../src/cache.mjs";
import { buildInvalidationSet, createCacheInvalidator } from "../src/cacheInvalidation.mjs";
import createWorkItemService from "../src/services/workItemService.mjs";
import createWorkItemController from "../src/controllers/workItemController.mjs";
import createWorkItemRoutes from "../src/routes/workItemRoutes.mjs";
import errorHandler from "../src/errorHandler.mjs";
import { FakeRedis } from "./helpers/fakeRedis.mjs";

function memoryRepositories(projectId, { failCreate = false } = {}) {
    const projects = new Map([[projectId, { id: projectId, name: "fixture project" }]]);
    const items = [];
    let nextId = 1;
    let listCalls = 0;
    const projectRepository = {
        async findById(id) { return projects.get(id) ?? null; }
    };
    const workItemRepository = {
        async create(item) {
            if (failCreate) throw new Error("simulated database write failure");
            const created = { id: nextId++, project_id: item.project_id, title: item.title };
            items.push(created);
            return created;
        },
        async findAll() {
            listCalls += 1;
            return { rows: [...items], total: items.length };
        },
        async findAllCursor() { return { rows: [...items], nextCursor: null, hasMore: false }; },
        async findById(id) { return items.find((item) => item.id === id) ?? null; },
        async update(id, data) {
            const item = items.find((entry) => entry.id === id);
            if (!item) return null;
            Object.assign(item, data);
            return item;
        },
        async remove(id) {
            const index = items.findIndex((entry) => entry.id === id);
            return index < 0 ? null : items.splice(index, 1)[0];
        }
    };
    return { projectRepository, workItemRepository, items, get listCalls() { return listCalls; } };
}

async function withApi(t, { projectId = 71003, failInvalidation = false, failCreate = false } = {}) {
    const redis = new FakeRedis();
    const cache = createCache(redis, { pollIntervalMs: 1 });
    const invalidateKeys = async (keys) => {
        if (failInvalidation) throw new Error("simulated Redis failure");
        return createCacheInvalidator(redis)(keys);
    };
    const repos = memoryRepositories(projectId, { failCreate });
    const service = createWorkItemService({ ...repos, invalidateKeys });
    const app = express();
    app.use(express.json());
    app.use(createCacheWorkItemsResponse(cache.getOrSetCache));
    app.use("/", createWorkItemRoutes({ workItemController: createWorkItemController({ workItemService: service }), redis }));
    app.use(errorHandler);
    const server = await new Promise((resolve) => {
        const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
    return { baseUrl: `http://127.0.0.1:${server.address().port}`, projectId, repos, redis };
}

test("invalidation map targets affected key families", () => {
    assert.deepEqual(buildInvalidationSet("workItem", { projectId: 15 }), [
        "http:work-items:*", "search:facets:v1", "reference:project-states:v1", "reference:project-members:15:v1"
    ]);
    assert.deepEqual(buildInvalidationSet("workItem", { projectId: 15, operation: "update-title" }), ["http:work-items:*"]);
    assert.deepEqual(buildInvalidationSet("workItem", { projectId: 15, operation: "delete" }), [
        "http:work-items:*", "search:facets:v1", "reference:project-states:v1", "reference:project-members:15:v1"
    ]);
    assert.deepEqual(buildInvalidationSet("project", { id: 15, operation: "update" }), []);
    assert.deepEqual(buildInvalidationSet("project", { id: 15, operation: "delete" }), [
        "http:work-items:*", "search:facets:v1", "reference:project-members:15:v1"
    ]);
    assert.deepEqual(buildInvalidationSet("label"), ["reference:labels:v1", "search:facets:v1"]);
});

test("a concurrent cold cache is filled once; distinct keys fetch independently", async () => {
    const cache = createCache(new FakeRedis(), { pollIntervalMs: 1 });
    let calls = 0;
    const fetchData = async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 15));
        return { ok: true };
    };
    const values = await Promise.all(Array.from({ length: 200 }, () => cache.getOrSetCache("same", fetchData)));
    assert.equal(calls, 1);
    assert.equal(values.filter((value) => value.ok).length, 200);

    await Promise.all(["one", "two"].map((key) => cache.getOrSetCache(key, fetchData)));
    assert.equal(calls, 3);
});

test("expired locks can be recovered and an owner never releases another owner's lock", async () => {
    const redis = new FakeRedis();
    await redis.set("lock:orphan", "abandoned", { PX: 15 });
    const cache = createCache(redis, { lockTtlMs: 30, waitTimeoutMs: 300, pollIntervalMs: 2 });
    assert.equal(await cache.getOrSetCache("orphan", async () => "recovered"), "recovered");

    const guardedRedis = new FakeRedis();
    const evaluate = guardedRedis.eval.bind(guardedRedis);
    guardedRedis.eval = async (script, options) => {
        await guardedRedis.set(options.keys[0], "different-owner", { PX: 1000 });
        return evaluate(script, options);
    };
    const guardedCache = createCache(guardedRedis);
    assert.equal(await guardedCache.getOrSetCache("owned", async () => "value"), "value");
    assert.equal(await guardedRedis.get("lock:owned"), "different-owner");
});

test("failed backend reads are not cached and do not produce unhandled retries", async () => {
    const cache = createCache(new FakeRedis());
    let calls = 0;
    await assert.rejects(cache.getOrSetCache("failed", async () => {
        calls += 1;
        throw new Error("database unavailable");
    }), /database unavailable/);
    assert.equal(await cache.getOrSetCache("failed", async () => {
        calls += 1;
        return "recovered";
    }), "recovered");
    assert.equal(calls, 2);

    const concurrentFailures = await Promise.allSettled(Array.from({ length: 4 }, () =>
        cache.getOrSetCache("parallel-fail", async () => {
            calls += 1;
            throw new Error("backend still down");
        })
    ));
    assert.equal(concurrentFailures.every((result) => result.status === "rejected"), true);
    assert.equal(calls, 6);
});

test("Redis read or lock failures fall back to exactly one backend fetch", async () => {
    let calls = 0;
    const unavailable = createCache({
        async get() { throw new Error("Redis offline"); },
        async set() { throw new Error("Redis offline"); }
    }, { logger: { error() {} } });
    assert.equal(await unavailable.getOrSetCache("read-down", async () => { calls += 1; return 1; }), 1);
    assert.equal(calls, 1);

    const lockFailureRedis = new FakeRedis();
    const set = lockFailureRedis.set.bind(lockFailureRedis);
    lockFailureRedis.set = async (key, value, options) => {
        if (key.startsWith("lock:")) throw new Error("Redis lock write failed");
        return set(key, value, options);
    };
    const lockUnavailable = createCache(lockFailureRedis, { logger: { error() {} } });
    assert.equal(await lockUnavailable.getOrSetCache("lock-down", async () => { calls += 1; return 2; }), 2);
    assert.equal(calls, 2);

    const timedOutRedis = {
        async get() { return null; },
        async set() { return null; }
    };
    const timedOutCache = createCache(timedOutRedis, { waitTimeoutMs: 4, pollIntervalMs: 1 });
    assert.equal(await timedOutCache.getOrSetCache("timeout", async () => { calls += 1; return 3; }), 3);
    assert.equal(calls, 3);
});

test("HTTP cache warms, hits, and invalidates after create, update, and delete", async (t) => {
    const api = await withApi(t);
    const listUrl = `${api.baseUrl}/work-items?page=1&limit=50`;
    const first = await fetch(listUrl);
    assert.equal(first.headers.get("x-cache"), "MISS");
    assert.equal((await first.json()).total, 0);
    const second = await fetch(listUrl);
    assert.equal(second.headers.get("x-cache"), "HIT");
    assert.equal(api.repos.listCalls, 1);

    const createdResponse = await fetch(`${api.baseUrl}/projects/${api.projectId}/work-items`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "cache fixture" })
    });
    assert.equal(createdResponse.status, 201);
    const { workItem } = await createdResponse.json();
    const afterCreate = await fetch(listUrl);
    assert.equal(afterCreate.headers.get("x-cache"), "MISS");
    assert.equal((await afterCreate.json()).total, 1);

    await api.redis.set("search:facets:v1", "keep-on-title-change");
    await api.redis.set(`reference:project-members:${api.projectId}:v1`, "keep-members");

    const update = await fetch(`${api.baseUrl}/work-items/${workItem.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "updated fixture" })
    });
    assert.equal(update.status, 200);
    await update.arrayBuffer();
    const afterUpdate = await fetch(listUrl);
    assert.equal(afterUpdate.headers.get("x-cache"), "MISS");
    assert.equal((await afterUpdate.json()).data[0].title, "updated fixture");
    assert.equal(await api.redis.get("search:facets:v1"), "keep-on-title-change");
    assert.equal(await api.redis.get(`reference:project-members:${api.projectId}:v1`), "keep-members");

    await api.redis.set("reference:labels:v1", "keep-label-cache");
    const remove = await fetch(`${api.baseUrl}/work-items/${workItem.id}`, { method: "DELETE" });
    assert.equal(remove.status, 200);
    await remove.arrayBuffer();
    const afterDelete = await fetch(listUrl);
    assert.equal(afterDelete.headers.get("x-cache"), "MISS");
    assert.equal((await afterDelete.json()).total, 0);
    assert.equal(await api.redis.get("reference:labels:v1"), "keep-label-cache");
});

test("invalid project and failed or missing writes do not invalidate cache", async (t) => {
    const api = await withApi(t);
    await api.redis.set("sentinel", "still-here");
    const invalidProject = await fetch(`${api.baseUrl}/projects/999999/work-items`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "no project" })
    });
    assert.equal(invalidProject.status, 404);
    assert.equal(await api.redis.get("sentinel"), "still-here");

    const missingUpdate = await fetch(`${api.baseUrl}/work-items/999999`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "absent" })
    });
    assert.equal(missingUpdate.status, 404);
    const missingDelete = await fetch(`${api.baseUrl}/work-items/999999`, { method: "DELETE" });
    assert.equal(missingDelete.status, 404);
    assert.equal(await api.redis.get("sentinel"), "still-here");
});

test("failed database create does not invalidate cached data", async (t) => {
    const api = await withApi(t, { failCreate: true });
    await api.redis.set("sentinel", "still-here");
    const response = await fetch(`${api.baseUrl}/projects/${api.projectId}/work-items`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "fails" })
    });
    assert.equal(response.status, 500);
    assert.equal(await api.redis.get("sentinel"), "still-here");
});

test("a committed write is explicit when cache invalidation fails", async (t) => {
    const api = await withApi(t, { failInvalidation: true });
    const response = await fetch(`${api.baseUrl}/projects/${api.projectId}/work-items`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "committed" })
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.writeCommitted, true);
    assert.equal(api.repos.items.length, 1);
});

test("wildcard invalidation scans and deletes all matching keys only", async () => {
    const redis = new FakeRedis();
    await redis.set("http:work-items:v1:/work-items?a", "a");
    await redis.set("http:work-items:v1:/work-items?b", "b");
    await redis.set("reference:labels:v1", "label");
    assert.equal(await createCacheInvalidator(redis)(["http:work-items:*"]), 2);
    assert.equal(await redis.get("reference:labels:v1"), "label");
});

test("wildcard invalidation follows multiple SCAN cursors before deleting", async () => {
    const seenCursors = [];
    const deleted = [];
    const client = {
        async scan(cursor) {
            seenCursors.push(String(cursor));
            return String(cursor) === "0"
                ? { cursor: "17", keys: ["http:work-items:a"] }
                : { cursor: "0", keys: ["http:work-items:b"] };
        },
        async del(keys) { deleted.push(...keys); return keys.length; }
    };
    assert.equal(await createCacheInvalidator(client)(["http:work-items:*"]), 2);
    assert.deepEqual(seenCursors, ["0", "17"]);
    assert.deepEqual(deleted, ["http:work-items:a", "http:work-items:b"]);
});
