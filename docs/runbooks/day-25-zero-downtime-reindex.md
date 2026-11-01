# Day 25 — Zero-Downtime Elasticsearch Reindex and Rollback

## Goal

Change an Elasticsearch mapping that cannot be changed in place, reindex data into a new index, switch traffic atomically through an alias, test search availability during migration, and verify rollback.

## Indexes

- **Source:** `work_items_v2`
- **Target:** `work_items_v3`
- **Live alias:** `work_items_current`
- **Mapping change:** Explicit date format on `created_at` in v3.
- **API endpoint:** `http://localhost:3000/search?q=test`

## 1. Create the target index

Created `work_items_v3` with the intended mapping before copying documents. The original index was preserved.

## 2. Initial sliced asynchronous reindex

Started an asynchronous sliced reindex from v2 to v3 using:

`POST /_reindex?wait_for_completion=false&slices=auto&refresh=true`

The returned task was polled using the Elasticsearch Tasks API.

**Result:**

- Documents processed: 500,302
- Documents created: 500,302
- Version conflicts: 0
- Failures: 0

## 3. Catch-up pass

Ran a second full reindex from v2 to v3. This repeated sweep ensured the target reflected the source at the time of the pass. It was a full repeat pass, not a filtered incremental catch-up.

**Result:**

- Documents processed: 500,302
- Documents updated: 500,302
- Version conflicts: 0
- Failures: 0

## 4. Verify document counts

Checked both indexes independently using the Elasticsearch Count API.

| Index | Document count |
|---|---:|
| `work_items_v2` | 500,302 |
| `work_items_v3` | 500,302 |

Both indexes had matching document counts.

## 5. Fix and verify the search endpoint

The search endpoint initially returned HTTP 400 because some aggregations and filters used text fields instead of their keyword subfields. The repository was updated to use mapping-compatible fields, including:

- `priority.keyword`
- `project_id.keyword`
- `assignee_id.keyword`
- `status` instead of `state`

The API was restarted with `ES_PASSWORD` configured.

**Baseline result:** `GET /search?q=test` returned HTTP 200.

## 6. Start the load generator

Started a background load generator in a separate terminal. It sent repeated requests to `/search?q=test` and recorded timestamps and HTTP status codes in:

`/tmp/day25-load.log`

The load generator was left running during the alias switch and rollback.

## 7. Atomic switch to v3

Submitted one Elasticsearch `_aliases` request containing both actions:

1. Remove `work_items_current` from `work_items_v2`.
2. Add `work_items_current` to `work_items_v3`.

Both actions were submitted together as one atomic alias update.

## 8. Atomic rollback to v2

Submitted one Elasticsearch `_aliases` request containing both actions:

1. Remove `work_items_current` from `work_items_v3`.
2. Add `work_items_current` to `work_items_v2`.

Both actions were submitted together as one atomic alias update. The original index was retained.

## 9. Load-test verification

Use the following command to calculate the actual request totals and HTTP status distribution from the log:

```bash
awk '{total++; if ($2 != 200) failed++; codes[$2]++} END {printf "Total requests: %d\nFailed requests: %d\nSuccessful HTTP 200: %d\n", total, failed, codes[200]; for (c in codes) printf "HTTP %s: %d\n", c, codes[c]}' /tmp/day25-load.log
```

Record the measured results below after running the command:

- **Total requests:** Pending measurement
- **Failed requests:** Pending measurement
- **HTTP 200 responses:** Pending measurement

Do not claim zero failed requests until the complete load log confirms that every request returned HTTP 200.

## Lessons learned

- Create a new index when an existing field mapping cannot be changed in place.
- Use asynchronous sliced reindexing to process large indexes.
- Verify document counts before changing the live alias.
- A single `_aliases` request can atomically switch traffic between indexes.
- Keep the original index intact until the replacement is verified.
- Run continuous requests during both migration and rollback to test availability.
- Ensure search queries, aggregations, and filters match the actual index mapping.
- A matching document count alone does not prove document-level equality or zero downtime; both require appropriate verification.

## Rollback principle

Keep the previous index available until the new index is verified. If problems appear after the switch, atomically point the alias back to the previous index. Do not delete either index as part of the migration.