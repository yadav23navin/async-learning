
# Day 22 — Daily Digest Job

## BUILD / SHIP

### Implemented
- Added `migrations/005_daily_digest.sql` to add `due_date` to work items and create the `digest_job_runs` table.
- Added `src/repositories/digestRepository.mjs` to find users with open items due tomorrow and record job results.
- Added `src/dailyDigest.mjs` with the daily digest scheduler, IST time handling, Redis lock, and Nodemailer email delivery.
- Added `npm run digest` for the scheduler and `npm run digest:once` for a manual run.
- Added `--dry-run` support to preview recipients and item counts without sending emails.
- Run records capture start/finish timestamps, users processed, emails sent, errors, status, and error details.

### Verification

1. JavaScript syntax
   - `node --check src/dailyDigest.mjs`
   - Passed before the final readability edit; passed again afterward.

2. Dry run
   - Found user Aarav with one open work item due tomorrow.
   - Logged the recipient and item count.
   - Sent no email.

3. Manual email test
   - Ran `npm run digest:once`.
   - One user processed, one email sent, zero errors.
   - Confirmed the email arrived in MailHog at `http://localhost:8025`.

4. Scheduler
   - Corrected the scheduler's minute key to use `Asia/Kolkata` rather than UTC.
   - Actual execution at 09:00 IST has not yet been observed.

### Result

The daily digest implementation, dry-run behavior, manual email delivery, database run recording, and Redis locking are in place. The real email delivery and dry-run were verified. A live scheduled 09:00 IST execution remains unverified.

============================================================================================================================================================================================================================================================================================================================================================================================================================================================

# Day 23 — Resumable Elasticsearch Backfill

## BUILD / SHIP

### Implemented
- Created `scripts/backfill.mjs` as a reusable backfill script.
- Added dry-run preview, target-cluster validation, and explicit confirmation before writes.
- Added batch processing (100 records per batch) and atomic checkpoint saving to `.backfill/points-zero.json`.
- Set missing `points` values to `0` in the `work_items` index.
- Added resume support using `--resume` and checkpoint validation.
- Added `--limit` and `--stop-after` options for controlled runs.

### Verification

1. Syntax and dry run
   - Ran `node --check scripts/backfill.mjs`; passed with no syntax errors.
   - Dry run found 500,300 documents missing `points`.
   - Previewed five sample documents without modifying data.

2. Backfill test
   - Initial 100-record test: 100 updated, zero failures.
   - Main 1,000-record job: 1,000 updated, zero skipped, zero failures.
   - Verified the missing-`points` count decreased from 500,300 to 499,200 after the first 1,000-record job.

3. Checkpoint and resume
   - Job `c2c354cf-5ff6-4ec7-8763-0bfdfb030778` stopped at 400 records.
   - Checkpoint was saved to `.backfill/points-zero.json`.
   - Resumed with `--resume`; the same job ID continued from 400 to 1,000.
   - Resume completed with 1,000 total updates and zero failures.

4. Final observed index count
   - Missing `points`: 495,800 before the last resumed job.
   - The last resumed job updated 1,000 additional documents.
   - The controlled stop/resume test passed. An external Ctrl+C interruption was not demonstrated.

### Result
The reusable backfill script, dry-run safety checks, batched updates, checkpoint persistence, and resume workflow were verified. The work was limited to 1,000-record runs; remaining documents still need backfilling if the goal is to update the entire index.

============================================================================================================================================================================================================================================================================================================================================================================================================================================================

# cat >> log.md <<'EOF'

============================================================================================================================================================================================================================================================================================================================================================================================================================================================

# Day 24 — Elasticsearch Activity Timestamp Migration

## BUILD / SHIP

### Implemented
- Added `last_activity_at` as an Elasticsearch `date` field in `work_items_v2`, using the `epoch_millis` format.
- Created `scripts/backfill-last-activity.mjs` to scan Elasticsearch documents in batches and retrieve each work item's latest related activity from PostgreSQL using `MAX(activities.created_at)`.
- Used Elasticsearch bulk updates to write `last_activity_at`, with `null` for work items without related activities.
- Ran a search load generator against `GET /search?q=test` throughout the scan + bulk migration.
- Benchmarked an Elasticsearch `update_by_query` Painless no-op pass separately.

### Migration Plan and ETA

Estimated total time before execution: 50–160 minutes.

Planned work:
1. Inspect the mapping, PostgreSQL activity relationship, and search endpoint.
2. Add the timestamp field and implement scan + bulk.
3. Benchmark the Painless `update_by_query` approach where applicable.
4. Verify document counts and field population.
5. Measure search latency during migration and compare against baseline.

### Verification and Results

1. Scan + bulk migration
   - Ran `ES_PASSWORD='...' node scripts/backfill-last-activity.mjs`.
   - Processed: 500,300 documents.
   - Updated: 500,300 documents.
   - Elasticsearch document count remained 500,300 before and after.
   - Duration: 77.3 seconds.
   - Bulk failures were not reported.

2. Field population
   - Documents with a non-null `last_activity_at`: 500,000.
   - Documents with a null `last_activity_at`: 300.
   - Verified the 300 work items had no matching activity rows in PostgreSQL.
   - Null timestamps are expected for those items.

3. Search latency during scan + bulk
   - Requests: 720.
   - Errors: 0.
   - p50: 6.13 ms.
   - p95: 10.96 ms.
   - Maximum: 217.99 ms.
   - Baseline p95 before migration: 12.28 ms.
   - Observed p95 did not degrade in this run; it was 1.32 ms lower than baseline. The maximum request latency was higher than p95, indicating occasional slow requests.

4. Painless `update_by_query` benchmark
   - Ran `update_by_query` with `ctx.op = "noop"` to avoid changing documents.
   - Scanned: 500,300 documents.
   - Updated: 0.
   - No-op count: 500,300.
   - Duration: 8.9 seconds.
   - Version conflicts: 0.
   - Failures: 0.
   - Search latency was not measured during this second run.

### Comparison and Limitations

- Scan + bulk performed the actual migration because it could query PostgreSQL for each batch's latest related activity timestamp.
- Painless `update_by_query` cannot query PostgreSQL directly. The no-op pass measured Elasticsearch-side scanning and script execution only; it did not compute or populate activity timestamps.
- Therefore, the two timings are not equivalent implementations of the same migration.
- Estimated total time: 50–160 minutes.
- Actual scan + bulk duration: 77.3 seconds, substantially below the estimate. This is the measured execution time, not the total time spent on planning and troubleshooting.

### Result

The scan + bulk migration completed across all 500,300 Elasticsearch documents with no reported bulk failures, unchanged document count, and verified null timestamps for 300 work items without related activities. Search p95 latency did not degrade in the observed run. The Painless no-op benchmark completed successfully but is not an alternative implementation of the PostgreSQL-derived timestamp calculation.
EOF

### Day 24 — Checklist Follow-up and Final Clarification

#### Throughput (documents per second)

Calculated as documents processed divided by measured elapsed seconds.

| Run | Documents | Runtime | Throughput |
|---|---:|---:|---:|
| Scan + bulk migration | 500,300 | 77.3 s | ~6,472 docs/sec |
| Painless no-op benchmark | 500,300 | 8.897 s | ~56,233 docs/sec |

These figures are approximate. The two runs perform different work, so their throughput is not a direct comparison of equivalent migrations.

#### ETA: estimate versus actual

- Initial estimated total effort: 50–160 minutes.
- Actual scan + bulk execution: 77.3 seconds.
- Why they differ: the estimate included inspection, implementation, verification, benchmarking, and documentation. The 77.3-second measurement covers only the scan + bulk execution. Therefore, it is not a like-for-like comparison of total project effort versus runtime.

#### Final acceptance status

- [x] Scan + bulk migration completed for 500,300 documents.
- [x] Search p95 during migration recorded: 10.96 ms versus 12.28 ms baseline; 720 requests and zero errors.
- [x] ETA estimate and migration runtime recorded, with explanation of the measurement difference.
- [x] Elasticsearch exists-count query returned exactly 500,000 documents with non-null `last_activity_at`.
- [x] The other 300 documents were verified to have no matching activity rows.
- [ ] A second independent migration that calculates latest activity timestamps using Painless alone is not feasible because the source activities are in PostgreSQL. The completed Painless run was a no-op benchmark, not a second migration.

**Conclusion:** The actual timestamp migration and its verification are complete. The strict requirement for two independent migration approaches remains unfulfilled; do not report it as complete.
