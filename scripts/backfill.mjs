import es from "../src/elasticsearchClient.mjs";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

const TARGET_INDEX = "work_items";
const EXPECTED_CLUSTER = "docker-cluster";
const MAX_RECORDS = 1000;
const BATCH_SIZE = 100;
const BATCH_DELAY_MS = Number(process.env.BACKFILL_DELAY_MS || 0);
const CHECKPOINT_DIR = ".backfill";
const CHECKPOINT_FILE = process.env.BACKFILL_CHECKPOINT || path.join(CHECKPOINT_DIR, "points-zero.json");
const OPERATION = "set-missing-points-to-zero";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const resume = args.has("--resume");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : MAX_RECORDS;
const stopArg = process.argv.find((arg) => arg.startsWith("--stop-after="));
const stopAfter = stopArg ? Number(stopArg.split("=")[1]) : null;

const query = {
  bool: {
    must_not: [{ exists: { field: "points" } }],
  },
};

async function saveCheckpoint(checkpoint) {
  await mkdir(CHECKPOINT_DIR, { recursive: true });
  const temp = `${CHECKPOINT_FILE}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(checkpoint, null, 2), { mode: 0o600 });
  await rename(temp, CHECKPOINT_FILE);
}

async function loadCheckpoint() {
  try {
    return JSON.parse(await readFile(CHECKPOINT_FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function confirmTarget(cluster) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(
      `Type APPLY ${cluster}/${TARGET_INDEX} to authorize writes: `,
    )) === `APPLY ${cluster}/${TARGET_INDEX}`;
  } finally {
    rl.close();
  }
}

async function main() {
  try {
    const info = await es.info();

    if (info.cluster_name !== EXPECTED_CLUSTER) {
      throw new Error("Unexpected cluster; refusing to continue.");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECORDS) {
      throw new Error(`--limit must be between 1 and ${MAX_RECORDS}.`);
    }
    if (stopAfter !== null &&
        (!Number.isInteger(stopAfter) || stopAfter < 1 || stopAfter > limit)) {
      throw new Error("--stop-after must be between 1 and --limit.");
    }
    if (resume && !apply) throw new Error("--resume requires --apply.");

    console.log("BACKFILL TARGET");
    console.log(JSON.stringify({
      cluster: info.cluster_name,
      index: TARGET_INDEX,
      mode: apply ? "APPLY" : "DRY RUN",
      limit,
      batchSize: BATCH_SIZE,
    }, null, 2));

    const count = await es.count({ index: TARGET_INDEX, query });
    console.log(`Documents missing points: ${count.count}`);
    console.log(`Eligible for this run: ${Math.min(count.count, limit)}`);

    if (!apply) {
      const preview = await es.search({
        index: TARGET_INDEX,
        size: 5,
        query,
        sort: [{ "id.keyword": "asc" }],
        _source: ["id", "title", "points"],
      });
      console.log("Sample documents (read-only):");
      console.log(JSON.stringify(preview.hits.hits.map((hit) => ({
        documentId: hit._id,
        source: hit._source,
      })), null, 2));
      console.log("Dry run complete. No documents were changed.");
      return;
    }

    let checkpoint;
    if (resume) {
      checkpoint = await loadCheckpoint();
      if (!checkpoint) throw new Error("No checkpoint found to resume.");
      if (
        checkpoint.version !== 2 ||
        checkpoint.cluster !== info.cluster_name ||
        checkpoint.index !== TARGET_INDEX ||
        checkpoint.operation !== OPERATION ||
        checkpoint.limit !== limit ||
        checkpoint.batchSize !== BATCH_SIZE
      ) {
        throw new Error("Checkpoint mismatch. Refusing to resume.");
      }
      console.log(`Resuming job ${checkpoint.jobId}; successful updates so far: ${checkpoint.updated}.`);
    } else {
      if (await loadCheckpoint()) {
        throw new Error("Checkpoint already exists. Use --resume or safely archive it first.");
      }
      const now = new Date().toISOString();
      checkpoint = {
        version: 2,
        jobId: randomUUID(),
        cluster: info.cluster_name,
        index: TARGET_INDEX,
        operation: OPERATION,
        limit,
        batchSize: BATCH_SIZE,
        completed: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        startedAt: now,
        updatedAt: now,
      };
      await saveCheckpoint(checkpoint);
    }

    if (checkpoint.updated >= limit) {
      console.log("Requested update limit already reached.");
      return;
    }

    if (!(await confirmTarget(info.cluster_name))) {
      console.log("Confirmation did not match. No writes performed.");
      return;
    }

    let stopped = false;
    let interrupted = false;
    process.once("SIGINT", () => {
      interrupted = true;
      console.log("\nCtrl+C received; stopping after the current batch.");
    });
    while (checkpoint.updated < limit) {
      const remaining = limit - checkpoint.updated;
      const response = await es.search({
        index: TARGET_INDEX,
        size: Math.min(BATCH_SIZE, remaining),
        query,
        sort: [{ "id.keyword": "asc" }],
        _source: ["id", "title", "points"],
      });

      const hits = response.hits.hits;
      if (!hits.length) break;

      const operations = [];
      for (const hit of hits) {
        operations.push({ update: { _index: TARGET_INDEX, _id: hit._id } });
        operations.push({
          script: {
            lang: "painless",
            source: "if (ctx._source.points == null) { ctx._source.points = 0; } else { ctx.op = 'noop'; }",
          },
        });
      }

      const result = await es.bulk({ operations, refresh: "wait_for" });
      let batchUpdated = 0;
      let batchSkipped = 0;
      let batchFailed = 0;

      for (const item of result.items) {
        if (item.update?.result === "updated") batchUpdated++;
        else if (item.update?.result === "noop") batchSkipped++;
        else batchFailed++;
      }

      checkpoint.updated += batchUpdated;
      checkpoint.skipped += batchSkipped;
      checkpoint.failed += batchFailed;
      checkpoint.completed += hits.length;
      checkpoint.updatedAt = new Date().toISOString();
      await saveCheckpoint(checkpoint);

      console.log(JSON.stringify({
        event: "backfill_batch_complete",
        jobId: checkpoint.jobId,
        processed: checkpoint.completed,
        updated: batchUpdated,
        skipped: batchSkipped,
        failed: batchFailed,
        totalUpdated: checkpoint.updated,
        limit,
      }));

      if (BATCH_DELAY_MS > 0) await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));

      if (interrupted) {
        stopped = true;
        console.log("Interrupted safely; checkpoint saved.");
        break;
      }

      if (batchFailed > 0) {
        throw new Error("Some updates failed. Checkpoint saved; rerun with --apply --resume.");
      }

      if (stopAfter !== null && checkpoint.completed >= stopAfter) {
        stopped = true;
        console.log("Controlled stop reached; checkpoint saved.");
        break;
      }
    }

    console.log(JSON.stringify({
      event: "backfill_summary",
      jobId: checkpoint.jobId,
      index: TARGET_INDEX,
      updated: checkpoint.updated,
      skipped: checkpoint.skipped,
      failed: checkpoint.failed,
      limit,
      stopped,
      checkpoint: CHECKPOINT_FILE,
    }, null, 2));
  } finally {
    await es.close();
  }
}

main().catch((error) => {
  console.error("Backfill failed:", error.message);
  process.exitCode = 1;
});
