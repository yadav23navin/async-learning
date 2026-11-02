import pg from "pg";
import es from "../src/elasticsearchClient.mjs";
import { performance } from "node:perf_hooks";

const { Client } = pg;
const INDEX = "work_items_v2";
const BATCH_SIZE = 500;
const SEARCH_URL = "http://localhost:3000/search?q=test";
const LOAD_INTERVAL_MS = 100;
const LOAD_DURATION_MS = Number(process.env.LOAD_DURATION_MS || 60000);

const db = new Client({
    host: process.env.PGHOST || "localhost",
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || "minitrack",
    user: process.env.PGUSER || "minitrack",
    password: process.env.PGPASSWORD || "minitrack"
});

const latency = [];
let loadRequests = 0;
let loadErrors = 0;
let stopLoad = false;

async function runSearchLoad() {
    while (!stopLoad) {
        const started = performance.now();

        try {
            const response = await fetch(SEARCH_URL);
            await response.arrayBuffer();

            if (!response.ok) {
                loadErrors++;
            } else {
                latency.push(performance.now() - started);
            }
        } catch {
            loadErrors++;
        }

        loadRequests++;
        await new Promise(resolve => setTimeout(resolve, LOAD_INTERVAL_MS));
    }
}

function percentile(values, p) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return Number(sorted[Math.ceil(p * sorted.length) - 1].toFixed(2));
}

async function main() {
    const start = performance.now();
    await db.connect();

    try {
        const info = await es.info();
        if (info.cluster_name !== "docker-cluster") {
            throw new Error(`Unexpected cluster: ${info.cluster_name}`);
        }

        const before = await es.count({ index: INDEX });
        console.log(`Starting ${INDEX}: ${before.count} documents`);
        console.log(`Batch size: ${BATCH_SIZE}`);
        console.log("Search load generator starting alongside migration.");

        const loadPromise = runSearchLoad();

        let searchAfter;
        let processed = 0;
        let updated = 0;

        while (true) {
            const page = await es.search({
                index: INDEX,
                size: BATCH_SIZE,
                sort: [{ "work_item_id": "asc" }],
                search_after: searchAfter,
                _source: ["work_item_id"]
            });

            const hits = page.hits.hits;
            if (!hits.length) break;

            const ids = hits
                .map(hit => Number(hit._source.work_item_id))
                .filter(Number.isSafeInteger);

            if (!ids.length) {
                throw new Error("No valid work_item_id values in batch.");
            }

            const activityResult = await db.query(
                `SELECT work_item_id, MAX(created_at) AS last_activity_at
                 FROM activities
                 WHERE work_item_id = ANY($1::bigint[])
                 GROUP BY work_item_id`,
                [ids]
            );

            const timestamps = new Map(
                activityResult.rows.map(row => [
                    String(row.work_item_id),
                    row.last_activity_at
                        ? new Date(row.last_activity_at).getTime()
                        : null
                ])
            );

            const operations = [];

            for (const hit of hits) {
                const id = String(hit._source.work_item_id);
                operations.push({
                    update: { _index: INDEX, _id: hit._id }
                });
                operations.push({
                    doc: {
                        last_activity_at_stage: timestamps.get(id) ?? null
                    }
                });
            }

            const result = await es.bulk({
                operations,
                refresh: false
            });

            if (result.errors) {
                const failures = result.items.filter(
                    item => item.update?.error
                );
                throw new Error(
                    `Bulk update failed: ${JSON.stringify(failures.slice(0, 3))}`
                );
            }

            processed += hits.length;
            updated += result.items.filter(
                item => item.update?.result === "updated"
            ).length;

            searchAfter = hits[hits.length - 1].sort;

            if (processed % 5000 === 0) {
                console.log(`Processed ${processed}; updated ${updated}`);
            }
        }

        await es.indices.refresh({ index: INDEX });

        stopLoad = true;
        await loadPromise;

        const after = await es.count({ index: INDEX });
        const elapsedSeconds = (performance.now() - start) / 1000;

        console.log("\n=== Scan + bulk summary ===");
        console.log(JSON.stringify({
            beforeCount: before.count,
            afterCount: after.count,
            processed,
            updated,
            elapsedSeconds: Number(elapsedSeconds.toFixed(2)),
            searchLoad: {
                requests: loadRequests,
                errors: loadErrors,
                p50_ms: percentile(latency, 0.50),
                p95_ms: percentile(latency, 0.95),
                max_ms: percentile(latency, 1)
            }
        }, null, 2));

        if (before.count !== after.count || processed !== before.count) {
            throw new Error("Verification failed: document counts differ.");
        }
    } finally {
        stopLoad = true;
        await db.end();
        await es.close();
    }
}

main().catch(error => {
    console.error("Migration failed:", error);
    process.exitCode = 1;
});