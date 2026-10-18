## Day 8 — Offset Pagination Benchmark

Implemented:

GET /work-items?page=&limit=&sort=

Response shape:

{
  "data": [...],
  "page": 2,
  "limit": 5,
  "total": 500000,
  "total_pages": 100000
}

Benchmark with limit=50:

| Page | Offset | Real time |
|---:|---:|---:|
| 1 | 0 | 0.227s |
| 100 | 4,950 | 0.208s |
| 1,000 | 49,950 | 0.203s |
| 5,000 | 249,950 | 0.252s |

Command used:

time curl -s "http://localhost:3000/work-items?page=1&limit=50&sort=created_at_desc" > /dev/null

Offset calculation:

OFFSET = (page - 1) * limit

Page 5000 therefore skips 249,950 rows before returning 50 rows.

## Offset Pagination Race Test

Test:
Paged through the dataset using OFFSET pagination while another script inserted 100 new rows.

Reader command:

node scripts/page-through.mjs

Concurrent insert command:

node scripts/insert-during-pagination.mjs

Result:

Expected original rows: 500,000
Items seen: 499,900
Duplicates: 100

The 100 concurrent inserts changed the positions of existing rows while pagination was in progress. Because OFFSET pagination uses row positions, later pages shifted and the reader saw 100 duplicate items while 100 original items were missed.

This demonstrates why OFFSET pagination is unsafe for a changing dataset when a consistent traversal is required.


---------------------------------------------------------------------------------------------------------------------------------------------------
---------------------------------------------------------------------------------------------------------------------------------------------------
# Day 8 — Offset Pagination & Why It Breaks

## Main Topic

Offset pagination and why it breaks when the underlying dataset changes while pagination is in progress.

---

## What I Learned

Pagination means returning a subset of a larger dataset instead of loading everything at once.

Offset pagination uses:

```sql
LIMIT 50 OFFSET 0;
LIMIT 50 OFFSET 50;
LIMIT 50 OFFSET 100;

The offset is calculated as:

OFFSET = (page - 1) * limit

For example:

page 1    → OFFSET 0
page 2    → OFFSET 50
page 100  → OFFSET 4,950
page 5000 → OFFSET 249,950

The database must skip the rows represented by the OFFSET before returning the requested rows.

Offset pagination also has a consistency problem when rows are inserted or deleted while the user is moving through pages.

If new rows are inserted at the beginning of the sorted result, existing rows shift positions. A later OFFSET can therefore point to rows that were already seen or skip rows that have not been seen yet.

A deterministic ORDER BY is important. The pagination query uses:

ORDER BY created_at DESC, id DESC

created_at controls the main ordering and id is the unique tiebreaker.

BUILD / SHIP
1. Implemented Offset Pagination API

Implemented:

GET /work-items?page=&limit=&sort=

The API now returns:

{
  "data": [...],
  "page": 2,
  "limit": 5,
  "total": 500000,
  "total_pages": 100000
}

The repository uses:

LIMIT $1
OFFSET $2

and also runs:

SELECT COUNT(*) AS total
FROM work_items;
2. Pagination API Test

Command:

curl -s "http://localhost:3000/work-items?page=2&limit=5&sort=created_at_desc"

Result confirmed:

page = 2
limit = 5
total = 500000
total_pages = 100000

The API returned exactly 5 items for the requested page.

3. Offset Pagination Benchmark

Benchmark command format:

time curl -s "http://localhost:3000/work-items?page=PAGE&limit=50&sort=created_at_desc" > /dev/null

Actual results:

Page	Offset	Real time
1	0	0.227s
100	4,950	0.208s
1,000	49,950	0.203s
5,000	249,950	0.252s

Page 5,000 requires:

OFFSET = (5000 - 1) × 50
       = 249,950

The benchmark was performed against the 500k-row dataset.

4. Concurrent Insert Test

Created:

scripts/page-through.mjs
scripts/insert-during-pagination.mjs

The reader paged through the dataset using:

ORDER BY created_at DESC, id DESC
LIMIT $1
OFFSET $2

At the same time, the second script inserted 100 new work items.

Reader command:

node scripts/page-through.mjs

Concurrent insert command:

node scripts/insert-during-pagination.mjs

Actual result:

Original rows: 500,000
Rows inserted during pagination: 100
Items seen: 499,900
Duplicates: 100

Therefore the test proved that:

100 items were seen twice
100 original items were missed

The problem happened because the newly inserted rows changed the positions of existing rows while OFFSET pagination was in progress.


==========================================================================================================================================================================================================================================================================================================

# Day 9 — Cursor / Keyset Pagination

## Main Topic

Cursor / keyset pagination — ship v0.2

## What I learned

Cursor pagination avoids OFFSET by remembering the last item from the previous page.

Our ordering is deterministic:

```sql
ORDER BY created_at DESC, id DESC

The cursor represents the last (created_at, id) pair from the previous page.

The next page uses:

WHERE (created_at, id) < ($1, $2)
ORDER BY created_at DESC, id DESC
LIMIT $3

For the first request there is no cursor, so the query simply returns the first page.

The API returns:

{
  "data": [],
  "next_cursor": "...",
  "has_more": true
}

The cursor is opaque to the client. Internally it contains created_at and id, encoded using Base64 URL encoding.

Cursor implementation

Added cursor encoding and decoding in:

src/repositories/workItemRepository.mjs

const encodeCursor = ({ created_at, id }) => {
    return Buffer.from(
        JSON.stringify({ created_at, id })
    ).toString("base64url");
};

const decodeCursor = (cursor) => {
    const decoded = Buffer.from(
        cursor,
        "base64url"
    ).toString("utf-8");

    return JSON.parse(decoded);
};

Added:

findAllCursor({ cursor, limit })

to the repository and exposed it through the service, controller, and route.

Endpoint:

GET /work-items/cursor?cursor=&limit=
API response

Example:

{
  "data": [...],
  "next_cursor": "...",
  "has_more": true
}

The next request sends the returned next_cursor.

Timestamp precision issue

During testing, cursor pagination initially stopped after only a few pages.

The database stores timestamps with microsecond precision, for example:

2026-09-23 11:42:10.831345+05:30

JavaScript Date serialization only preserved milliseconds, causing the cursor to become:

2026-09-23T06:12:10.831Z

The lost microsecond precision caused PostgreSQL to find no rows after the cursor.

The fix was to return created_at as text from PostgreSQL:

created_at::text AS created_at

This preserves the full timestamp precision inside the cursor.

After the fix, the cursor benchmark successfully reached page 5,000 and the full pagination test reached all 10,004 pages.

Cursor benchmark

Limit:

50

Measured HTTP request time:

Page	Offset pagination	Cursor pagination
1	0.227 s	136.946 ms
100	0.208 s	116.176 ms
1,000	0.203 s	139.634 ms
5,000	0.252 s	95.958 ms

The measurements include the complete HTTP request, Node.js/Express processing, PostgreSQL work, and response handling. Therefore the numbers should not be interpreted as pure SQL execution time.

The important difference is that cursor pagination does not become dependent on skipping an increasing number of rows with OFFSET.

Concurrent insert test

Yesterday's offset pagination test inserted 100 rows while the reader was paging through the dataset.

Offset result:

Items seen: 499900
Duplicates: 100

The dataset ended with 500100 rows, meaning the offset reader experienced duplicates and missed original rows because newly inserted rows shifted the positions of existing rows.

The same test was then run against the cursor endpoint.

Cursor result:

Pages: 10004
Items seen: 500200
Duplicates: 0

The cursor reader saw the original 500200 rows exactly once while the 100 new rows were being inserted.

This demonstrates that cursor pagination does not suffer from the same offset shifting problem when new rows are inserted before the current position.

Important comparison
Offset pagination:
100 concurrent inserts
→ 100 duplicate occurrences
→ 100 original items missed

Cursor pagination:
100 concurrent inserts
→ 0 duplicates
Files added / changed
Changed
src/repositories/workItemRepository.mjs
src/services/workItemService.mjs
src/controllers/workItemController.mjs
src/routes/workItemRoutes.mjs
Added
scripts/benchmark-cursor.mjs
scripts/page-through-cursor.mjs
Commands used

Start server:

npm run dev

Run cursor benchmark:

node scripts/benchmark-cursor.mjs

Run cursor pagination test:

node scripts/page-through-cursor.mjs

Run concurrent inserts:

node scripts/insert-during-pagination.mjs

Check row count:

SELECT COUNT(*) FROM work_items;
Day 9 result

Cursor pagination was implemented and tested successfully.

The API now supports both:

GET /work-items?page=&limit=&sort=

and:

GET /work-items/cursor?cursor=&limit=

The cursor endpoint successfully paged through 500,200 rows across 10,004 pages with zero duplicate IDs during the concurrent-insert test.


==================================================================================================================================================================

# Day 10

# Elasticsearch Day 10 Log

## Elasticsearch Setup

- Elasticsearch version: 9.5.3
- Index: `work_items`
- PostgreSQL work_items loaded: 500,300
- Elasticsearch documents: 500,300

## Analyzer Tests

### 1. Real Title

Input:
`Fix frontend issue in task creation`

Tokens:
```text
fix
frontend
issue
in
task
creation

What happened:
The standard analyzer split the title into individual words and lowercased Fix to fix.

2. Real Title

Input:
Improve user management performance

Tokens:

improve
user
management
performance

What happened:
The standard analyzer split the title into individual words and lowercased Improve to improve.

3. Punctuation and Hashtag

Input:
Fix Login Bug #123!

Tokens:

fix
login
bug
123

What happened:
The standard analyzer lowercased the words, removed punctuation such as # and !, and kept 123 as a token.

4. Hyphenated Word

Input:
Fix login-related issue

Tokens:

fix
login
related
issue

What happened:
The standard analyzer split the hyphenated word login-related into login and related, and lowercased Fix.

5. Emoji

Input:
Fix login issue 🚀

Tokens:

fix
login
issue
🚀

What happened:
The standard analyzer lowercased the words and kept the emoji 🚀 as its own token.


===================================================================================================================================================================
# Day 11 — Elasticsearch Mapping

## Explicit Strict Mapping

Created a new index:

`work_items_v2`

The index uses an explicit mapping with:

- `dynamic: strict`
- `title` → `text` with `keyword` subfield
- `description` → `text`
- `state` → `keyword`
- `assignee_id` → `keyword`
- `project_id` → `keyword`
- `labels` → `nested`
  - `id` → `keyword`
  - `name` → `keyword`
- `priority` → `keyword`
- `due_date` → `date` with `epoch_millis`
- `created_at` → `date` with `epoch_millis`
- `points` → `integer`

## Reindex

The existing `work_items` index contained 500,300 documents.

During reindexing:

- `status` was renamed to `state`
- `created_at` was converted from ISO date format to epoch milliseconds
- `id`, `updated_at`, and `version` were removed because they were not part of the new mapping
- Missing fields such as `labels`, `due_date`, and `points` were omitted

Reindex result:

```text
total: 500300
created: 500300
failures: []

The new index therefore contains all 500,300 documents.

Dynamic Strict Test

A document containing an unknown field was deliberately indexed:

{
  "title": "Strict mapping test",
  "unexpected_field": "this should fail"
}

Elasticsearch rejected it with:

{
  "error": {
    "root_cause": [
      {
        "type": "strict_dynamic_mapping_exception",
        "reason": "[3:25] mapping set to strict, dynamic introduction of [unexpected_field] within [_doc] is not allowed"
      }
    ],
    "type": "strict_dynamic_mapping_exception",
    "status": 400
  }
}

What this proves:

dynamic: strict prevents Elasticsearch from automatically adding unknown fields to the mapping. Instead, unexpected fields cause the document to be rejected immediately.

Object vs Nested

To demonstrate the difference, the same label data was tested using both object and nested.

The data was:

{
  "labels": [
    {
      "name": "bug",
      "color": "blue"
    },
    {
      "name": "feature",
      "color": "red"
    }
  ]
}
Object Mapping

The first demo index used:

"labels": {
  "type": "object"
}

Query:

{
  "query": {
    "bool": {
      "must": [
        {
          "term": {
            "labels.name": "bug"
          }
        },
        {
          "term": {
            "labels.color": "red"
          }
        }
      ]
    }
  }
}

This query asks for a label where:

name = bug

AND

color = red

But the actual data contains:

bug → blue

feature → red

The object mapping flattens the values, so Elasticsearch can incorrectly combine values from different array elements.

Result:

1 document matched

This is the object flattening problem.

Nested Mapping

The same data was indexed into nested_demo, where labels is mapped as:

"labels": {
  "type": "nested"
}

The query uses a nested query:

{
  "query": {
    "nested": {
      "path": "labels",
      "query": {
        "bool": {
          "must": [
            {
              "term": {
                "labels.name": "bug"
              }
            },
            {
              "term": {
                "labels.color": "red"
              }
            }
          ]
        }
      }
    }
  }
}

Result:

{
  "value": 0,
  "relation": "eq"
}

This is the correct result because there is no single label where:

name = bug AND color = red

The nested mapping preserves the relationship between fields inside each array element.

Day 11 Result

Explicit strict mapping was created and the existing 500,300 documents were successfully reindexed.

The strict mapping rejected an unknown field as expected.

The object vs nested test demonstrated that object mapping can produce a false match when querying multiple fields inside an array of objects, while nested mapping correctly preserves the relationship between fields.


=====================================================================================================================================================================================

## Day 12 — Query DSL & Filters

### Combined query

The combined ES query uses:

- `multi_match` on `title` and `description` for text search.
- `term` filter for `state`.
- `term` filter for `assignee_id`.
- `term` filter for `priority`.
- `range` filter for `created_at`.

The text search is placed in `must` because it requires relevance scoring.

The yes/no conditions are placed in `filter` because they do not need relevance scoring.

The combined query returned exactly 86 documents.

### must vs filter comparison

Same logical query, searching for `login`, with:
- state = `done`
- assignee_id = `18`
- priority = `high`
- created_at between `1790143930831` and `1790746098398`

Everything in `must`:
- took: 21 ms
- matches: 86

Text search in `must` and yes/no conditions in `filter`:
- took: 12 ms
- matches: 86

In this run, the correctly split query was 9 ms faster.

`took` is Elasticsearch's internal query execution time in milliseconds and can vary between runs.

### Cache effect

The correctly split query was run twice:

- First run: 12 ms
- Second run: 10 ms

The second run was faster, showing the effect of warmed/cached execution. Elasticsearch query time can still vary between runs because of system conditions.

================================================================================================================================================================================================================================================================================

{
day 12
## Day 12 — Query DSL & Filters

### Query DSL and filter context

The ES list query uses query context only where relevance matters and filter context for yes/no conditions.

Text search uses `multi_match` on:
- `title`
- `description`

The following conditions are placed inside `filter` because they do not require relevance scoring:
- `state`
- `assignee_id`
- `priority`
- `created_at` range
- `labels`

### Individual filters

#### State filter

Used `term` on the `state` keyword field.

Example:

```json
{
  "term": {
    "state": "done"
  }
}
Assignee filter

Used term on assignee_id.

Tested with:

assignee_id = 18
Priority filter

Used term on priority.

Tested with:

priority = high
Date range filter

Used range on created_at.

Tested range:

gte = 1790143930831
lte = 1790746098398
Labels filter

Labels are mapped as nested because a work item can have multiple labels and the relationship between label fields must be preserved.

Example:

{
  "nested": {
    "path": "labels",
    "query": {
      "term": {
        "labels.name": "backend"
      }
    }
  }
}

The backend label matched exactly:

83,113 work items
Combined query

The final combined query contains:

text search: login
state: done
assignee_id: 18
priority: high
created_at between 1790143930831 and 1790746098398
label: backend

The text search is in must.

All yes/no conditions are in filter.

The combined query returned:

17 documents
must vs filter comparison

Same logical query, searching for login, with:

state = done
assignee_id = 18
priority = high
created_at between 1790143930831 and 1790746098398

Everything in must:

took: 21 ms
matches: 86

Text search in must and yes/no conditions in filter:

first run: 12 ms
second run: 10 ms
matches: 86

The correctly split query was faster in these runs.

The second run was faster than the first, showing the effect of warmed/cached execution. took can vary between runs depending on system conditions.

_source filtering

Restricted _source to the fields needed by the list:

[
  "title",
  "description",
  "state",
  "assignee_id",
  "priority",
  "created_at"
]

This prevents Elasticsearch from returning unnecessary document fields.

Empty filter array

Tested:

{
  "query": {
    "bool": {
      "filter": []
    }
  }
}

Elasticsearch treats an empty filter array as having no filtering conditions, so it can match all documents.

This is important when building queries dynamically: application code must explicitly handle an empty filter list according to the endpoint's intended behavior instead of assuming filter: [] restricts results.

Day 12 result

Implemented and tested:

text search
state filter
assignee filter
priority filter
date range filter
nested labels filter
combined query
query vs filter comparison
cache/warm execution comparison
_source filtering
empty filter behavior
}


====================================================================================================================================================================================================================================
##day 13


## Dashboard Aggregation: Default Size vs. Correct Size

### Objective

Demonstrate how Elasticsearch's `terms` aggregation can return only a subset of distinct values when the `size` parameter is omitted, and fix it by explicitly setting the required bucket count.

### Test Setup

* Index: `dashboard_assignee_test`
* Documents indexed: 40
* Distinct assignees: 40 (`user_1` through `user_40`)
* Aggregation field: `assignee_id.keyword`

### 1. Broken Aggregation — Default Size

Query:

```json
{
  "size": 0,
  "aggs": {
    "by_assignee": {
      "terms": {
        "field": "assignee_id.keyword"
      }
    }
  }
}
```

**Observed output:**

```json
{
  "bucket_count": 10,
  "doc_count_error_upper_bound": 0
}
```

Only 10 buckets were returned even though the index contains 40 distinct assignees. The default `terms` aggregation size is 10, so the other 30 assignees were omitted from the response.

### 2. Corrected Aggregation — Explicit Size

Query:

```json
{
  "size": 0,
  "aggs": {
    "by_assignee": {
      "terms": {
        "field": "assignee_id.keyword",
        "size": 20
      }
    }
  }
}
```

**Observed output:**

```json
{
  "bucket_count": 20,
  "doc_count_error_upper_bound": 0
}
```

Setting `size: 20` returns 20 buckets instead of 10. This fixes the default-size truncation for the requested top 20 assignees. It does not return all 40; to request all 40 in this test, set `size: 40`.

### 3. Understanding `doc_count_error_upper_bound`

Both aggregation responses returned:

```json
"doc_count_error_upper_bound": 0
```

This means Elasticsearch reports no bucket document-count error for these results.

* `0`: no count error is reported.
* Positive value: bucket document counts may be underestimated by up to the reported bound.
* `-1`: Elasticsearch cannot provide a finite upper bound, which deserves investigation if accurate counts are required.

**Important:** A zero error bound does not mean every distinct value was returned. The default aggregation still returned only 10 of the 40 assignees. Bucket truncation and document-count error are different issues.

### Conclusion

The default `terms` aggregation size can silently omit buckets when there are more distinct values than the configured size. Explicitly setting `size` to the required number of buckets prevents this specific truncation, while `doc_count_error_upper_bound` helps assess the accuracy of returned bucket counts.


======================================================================================================================================================================================================================================================================================================

#day 14
# Day 14

## Bulk Indexing, Partial Failures, Retries, and Update by Query

### Objective

Build a reliable Elasticsearch bulk indexer that loads 100,000 documents in batches, detects partial failures, collects failed document IDs and reasons, retries retryable failures once, and uses `update_by_query` with Painless to backfill missing priorities.

### Test Setup

* Source database: PostgreSQL (`minitrack`)
* Source table: `work_items`
* Target index: `work_items_bulk_lab`
* Target mapping: `dynamic: strict`
* Batch size: 2,000 documents
* Total documents processed: 100,000
* Intentionally poisoned documents: 50
* Poisoned field: `points` (mapped as `integer`)

### 1. Bulk Indexing — Batch Processing

The indexer reads documents from PostgreSQL in batches of 2,000 using keyset pagination:

```sql
WHERE id > $1
ORDER BY id
LIMIT $2
```

Each batch is sent to Elasticsearch using the Bulk API. The indexer continues through all batches until 100,000 documents have been processed.

**Observed output:**

```text
Processed 2000/100000
Processed 4000/100000
...
Processed 98000/100000
Processed 100000/100000
```

Batch processing avoids sending all 100,000 documents in one enormous request and allows progress to be tracked.

### 2. Deliberate Mapping Failures — Poisoned Documents

To test partial failure handling, the first 50 documents were deliberately given an invalid value for `points`:

```json
{
  "points": "not-an-integer"
}
```

The mapping defines `points` as an integer, so Elasticsearch rejected these documents with HTTP 400 mapping errors.

**Observed summary:**

```text
Documents read: 100000
Indexed successfully: 99950
Successful operations: 99950
Failed operations: 50
Retried operations: 0
Failure IDs collected: 50
Expected poisoned failures: 50

PASS: 99,950 documents indexed; 50 poisoned documents rejected.
```

The indexer collected each failed document's ID, status, and error reason. The reported failures were IDs `1` through `50`, and the reasons identified the invalid `points` value.

This proves that the indexer can continue processing valid documents even when some items in a bulk request fail.

### 3. Understanding `response.errors` and Retries

The Bulk API response includes an `errors` flag that indicates whether any individual operation failed.

The indexer checks this flag after every initial bulk request and examines individual item results when errors occur.

It retries only retryable HTTP statuses:

* `429`: Too many requests.
* `502`: Bad gateway.
* `503`: Service unavailable.
* `504`: Gateway timeout.

Each retryable item is retried once. Permanent mapping errors, such as HTTP 400, are recorded rather than retried.

**Observed result:** zero retries were needed because all 50 deliberately poisoned documents failed due to permanent mapping errors.

**Important:** An HTTP-successful bulk request does not guarantee that every document was indexed successfully. Individual item results must also be checked.

### 4. Backfilling Missing Priorities with `update_by_query`

The goal was to set `priority` to `"medium"` only for documents where the field was missing.

First, five test documents (`51` through `55`) had their `priority` fields removed using `update_by_query`.

The backfill then used this query to find documents without the field:

```json
{
  "query": {
    "bool": {
      "must_not": [
        {
          "exists": {
            "field": "priority"
          }
        }
      ]
    }
  }
}
```

A Painless script added the missing value:

```painless
if (!ctx._source.containsKey("priority")) {
    ctx._source.priority = "medium";
} else {
    ctx.op = "noop";
}
```

The request used `refresh=true` so the changes would be searchable when it completed.

**Observed output:**

```json
{
  "total": 5,
  "updated": 5,
  "deleted": 0,
  "version_conflicts": 0,
  "failures": []
}
```

All five documents were updated successfully. A subsequent count query returned:

```json
{
  "count": 0
}
```

This confirms that no documents remained without `priority`. Fetching document `51` also confirmed that its `_source` contained:

```json
{
  "priority": "medium"
}
```

### 5. Understanding Version Conflicts

A version conflict can occur when a document changes after Elasticsearch searches for it but before the update is applied. For example, another request may update the same document concurrently.

Using `conflicts=proceed` with `update_by_query` tells Elasticsearch to continue processing other documents when version conflicts occur instead of aborting the operation.

It does not automatically resolve the conflicting document. Conflicts should be inspected, and any skipped documents that still require updating may need another pass.

The successful backfill above reported zero version conflicts. The `conflicts=proceed` behavior should be understood separately from the successful no-conflict run.

### Conclusion

This exercise demonstrated reliable bulk indexing, partial failure detection, error collection, selective retries, and missing-field backfills in Elasticsearch.

The poisoned run indexed 99,950 documents and rejected exactly 50 documents with recorded reasons. The priority backfill updated five test documents to `"medium"`, and verification confirmed that zero documents remained without a priority.

Key lessons:

* Process large datasets in manageable batches.
* Check `response.errors` and individual item results for every bulk request.
* Retry transient failures once, but do not blindly retry permanent mapping errors.
* Collect failed IDs and reasons for diagnosis and recovery.
* Use `update_by_query` with Painless to update documents matching a precise condition.
* Understand that `conflicts=proceed` skips version conflicts and continues; it does not guarantee every document was updated.

======================================================================================================================================================================================================================================================================================================
#Day 15

### Full CSV Export and Memory Test

- **Endpoint:** `GET /export`
- **Dataset:** 500,300 work items
- **HTTP status:** 200 OK
- **CSV rows:** 500,301 (including the header)
- **CSV size:** approximately 122 MiB
- **Export duration:** 60.32 seconds
- **Initial RSS:** 130,140 KB
- **Peak RSS:** 133,872 KB
- **Final RSS:** 133,288 KB
- **Peak RSS increase:** 3,732 KB (approximately 3.64 MiB)

**Conclusion:** The full export completed successfully. RSS remained relatively stable throughout the export, increasing by approximately 3.64 MiB at its peak. This supports the use of streaming and bounded batches rather than buffering the entire CSV in application memory. These are results from one run, so further runs would strengthen the conclusion.

======================================================================================================================================================================================================================================================================================================

## Day 16 — Cache-Aside Implementation and Benchmark

### Implementation

* Added cache-aside support using Redis through `getOrSetCache`.
* Added cached reference lookups for project states, labels, and project members.
* Added caching for successful `GET /work-items` responses with a 60-second TTL.
* Added cache hit/miss logging and an `X-Cache` response header for the work-items list endpoint.
* Verified that `/reference/states`, `/reference/labels`, and `/reference/projects/1/members` all return HTTP 200.

### Benchmark

* Endpoint: `GET /work-items?page=1&limit=50`
* Requests: 100
* Cache hits: 99
* Cache misses: 1
* Cache hit rate: 99%
* p50 latency before caching: 90.56 ms
* p50 latency after caching: 1.71 ms
* p95 latency before caching: 109.00 ms
* p95 latency after caching: 2.19 ms
* Redis used memory: 1.09 MB
* Redis peak memory: 1.10 MB

### Observations

The benchmark showed a substantial reduction in observed request latency when the response was served from Redis. The cache hit rate was 99% after the initial cache miss. Redis memory usage remained approximately 1.09 MB during the measurement.

### Notes

The latency measurements are from a local run and may vary with system load, cache state, and dataset size. The benchmark measures repeated requests for the same list URL; it does not establish performance for every query or workload.

## Day 17 — Cache Invalidation and Stampede Protection

### Database write path repairs

The project lookup bug came from `projectRepository` keeping an empty in-memory array while `work_items.project_id` refers to rows in PostgreSQL. `GET /projects` and `findById()` therefore could not see the PostgreSQL project IDs (including project `1`). The repository now reads and writes the `projects` table. Project creation uses the first configured organization when no organization is supplied because `projects.organization_id` is required; the ID is selected from the database rather than hardcoded.

The PostgreSQL work-item repository also had no `create()` method, although the service called it. It now inserts a row and returns the database-generated ID and columns. Read, update, and delete return their `RETURNING` row or `null`; controllers await async service results. Invalid numeric IDs return `400 BAD_REQUEST` before reaching PostgreSQL.

### Cache keys and invalidation

* Work-item HTTP responses use `http:work-items:v1:<original URL>` with a 60-second TTL. Query variants are separate keys; writes scan and clear the `http:work-items:*` namespace.
* Search facets use `search:facets:v1`; reference data uses `reference:project-states:v1`, `reference:labels:v1`, and `reference:project-members:<projectId>:v1`.
* `buildInvalidationSet("workItem", { projectId, operation })` maps create/delete to the list namespace, search facets, and project states. Deletes additionally invalidate that project's member reference. Title-only updates invalidate only the HTTP list namespace.
* Project deletes clear work-item lists, search facets, and the deleted project's member reference. Project create and name-only update do not invalidate these caches because the current cached values do not depend on those writes.
* Label writes map to label references and search facets. There is no label write route/repository in the current API. Tasks are currently in-memory and have no cache consumer, so task writes do not invalidate PostgreSQL or search caches.
* Wildcard invalidation collects the full SCAN result before deleting in batches; it does not use Redis `KEYS` or mutate the keyspace while scanning.

Invalidation runs after each successful database statement returns its row. A database error or a missing-row result does not invalidate caches. If Redis invalidation fails after the database committed, the API returns `503 CACHE_INVALIDATION_ERROR` with `writeCommitted: true` and tells the caller not to retry blindly. The database change remains committed, so stale cache entries may remain until TTL expiry or a successful manual invalidation.

### Stampede protection and measurement

On a cache miss, the caller acquires `lock:<cache-key>` with Redis `SET NX PX`, a 30-second expiry, and a unique token. It fetches and caches a successful result, then releases the lock through an atomic compare-token-and-delete script. Followers poll for the cached value; after a bounded 30-second wait, they use a backend fallback. Redis errors bypass the cache and execute one backend fetch for that request. Failed backend results are not cached. As with any cache, if Redis is unavailable for many simultaneous requests, cache protection is unavailable and backend load can rise.

The benchmark's `workItemListFetches` metric increments immediately before the PostgreSQL list SELECT in `workItemRepository.findAll()`. Development-only endpoints reset/read this process-local counter; the script does not infer backend activity from HTTP headers. The benchmark clears only its URL's cache and lock keys for each round, then restores their original Redis values/TTLs.

Measured on the local app with 200 concurrent requests per round (2026-10-18):

| Mode | Requests | PostgreSQL list fetches | Successes | Failures | Elapsed |
|---|---:|---:|---:|---:|---:|
| Lock disabled | 200 | 97 | 97 | 103 | 6,361.8 ms |
| Lock enabled | 200 | 1 | 200 | 0 | 282.7 ms |

The unlocked run reached PostgreSQL's connection limit (`sorry, too many clients already`); this is the measured failure mode, not a fabricated all-success baseline. The locked run returned 200 successful responses after one list fetch.

### Tests and API validation

* `npm test`: 13 tests passed. They cover concurrent cold misses, separate keys, lock expiry and ownership-safe release, backend/Redis failures, invalidation mappings, multi-cursor wildcard scans, HTTP HIT/MISS behavior, create/update/delete cache refresh, missing/invalid project and work-item IDs, committed-write reporting, and repository row contracts. Database repositories are exercised with injected fake PostgreSQL clients; route-level cache tests use an isolated in-memory Redis adapter.
* `API_URL=http://localhost:3001 npm run validate:api`: passed against local Redis and PostgreSQL. It created a temporary project and work item, verified project lookup, CRUD, list cache HIT/MISS, query pagination, cursor first-page behavior, invalid ID handling, and cleanup. `GET /work-items/500300` returned HTTP 200. The temporary work item (ID 500303) and project were deleted; a follow-up database query found zero `day17-%` projects or work items.
* `STAMPEDE_URL='http://localhost:3001/work-items?page=1&limit=50' npm run stampede`: passed its assertions with the measurements above.

### Commands

```sh
sudo systemctl start postgresql redis-server
sudo systemctl start elasticsearch
PORT=3000 NODE_ENV=development npm start
npm test
API_URL=http://localhost:3000 npm run validate:api
STAMPEDE_URL='http://localhost:3000/work-items?page=1&limit=50' npm run stampede
```

The API uses `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD` when provided. Redis uses `REDIS_URL`. The stampede metrics and baseline-bypass header are restricted to non-production mode; run the benchmark only against a local development/test server.

The Elasticsearch-backed reference endpoints were also checked, but returned HTTP 500 because the configured Elasticsearch service at `http://localhost:9200` was unavailable. Start Elasticsearch and ensure index `work_items_v2` exists before retrying `/reference/states`, `/reference/labels`, `/reference/projects/:projectId/members`, or `/search`.


# Day 17
Day 17 — Cache Invalidation, Stampede Protection, and API Validation

1. Objective

Implement PostgreSQL-backed project and work-item CRUD.

Add Redis caching and invalidate cached responses after mutations.

Prevent cache stampedes when many requests arrive simultaneously.

Handle empty-result caching deliberately.

Validate the API and Elasticsearch connectivity.

2. Start the Development Services

Start Elasticsearch

docker start es-local-dev

Check the Elasticsearch version and connectivity:

curl -u 'elastic:<ELASTIC_PASSWORD>' http://localhost:9200

Observed result: Elasticsearch 9.5.3 responded successfully.

Check cluster health:

curl -u 'elastic:<ELASTIC_PASSWORD>' --max-time 10 \
  'http://localhost:9200/_cluster/health?pretty'

Observed result:

Cluster: docker-cluster

Status: yellow

Nodes: 1

Active primary shards: 74

Unassigned primary shards: 0

Unassigned shards: 10

The yellow status is consistent with a single-node cluster where replica shards cannot be assigned to a second node. All primary shards were active.

Activate the Basic License

The Elasticsearch trial license had expired, causing authenticated requests to return HTTP 403 with a security-license compliance error.

curl -u 'elastic:<ELASTIC_PASSWORD>' \
  -X POST 'http://localhost:9200/_license/start_basic?acknowledge=true'

Verify the license:

curl -u 'elastic:<ELASTIC_PASSWORD>' \
  'http://localhost:9200/_license?pretty'

Observed result: License status active, type basic.

List Elasticsearch Indices

curl -u 'elastic:<ELASTIC_PASSWORD>' \
  'http://localhost:9200/_cat/indices?v'

Observed indices included:

Index

Document count

work_items

500,300

work_items_v2

1,499,560

tasks_aggregation

150

The existing indices remained available after switching the license.

Start Redis

The Docker Redis container could not start because port 6379 was already occupied by a local Redis process.

redis-cli ping

Expected response when Redis is available:

PONG

If the local Redis service is stopped:

sudo systemctl start redis-server

The earlier Docker error was a port conflict, not evidence that Redis itself was unavailable.

3. Start and Validate the API

Start the application:

npm start

Leave the server running in one terminal. In a second terminal, run:

API_URL=http://localhost:3000 npm run validate:api

Observed result:

GET /work-items/500300: HTTP 200
API validation passed; temporary project and work item 500304 cleaned up.

This confirmed that the API responded successfully and the validation script cleaned up its temporary test records.

Note: using port 3001 initially failed with ECONNREFUSED. The application was subsequently validated successfully on port 3000.

4. PostgreSQL and Repository Fixes

The project lookup and work-item creation paths originally had a datastore mismatch:

Project lookup used an in-memory array.

Work items referenced projects stored in PostgreSQL.

The PostgreSQL work-item repository did not implement create().

The implementation was updated so that project CRUD uses PostgreSQL and work-item CRUD returns database-backed records. Controllers were updated to await asynchronous service calls.

Project creation selects the first configured organization because the API does not currently accept an organization ID.

A direct lookup was also verified:

curl http://localhost:3000/work-items/500300

Observed result: HTTP 200 with a work-item response containing ID 500300.

5. Redis Caching and Invalidation

The implementation introduced or updated:

Shared cache invalidation in src/cacheInvalidation.mjs.

Project mutation invalidation in src/services/projectService.mjs.

Work-item mutation invalidation in src/services/workItemService.mjs.

Work-item response caching in src/cacheWorkItemsResponse.mjs.

General cache and stampede protection in src/cache.mjs.

The reviewed service code routes these write operations through the shared invalidation mechanism:

Project create, update, and delete.

Work-item create, title update, and delete.

The invalidation mechanism uses Redis key deletion internally. This is expected; the important distinction is that services should use the shared invalidation set rather than manually clearing arbitrary cache keys.

Acceptance criterion still requiring a complete code audit: Verify that every cache-affecting mutation uses the shared invalidation set and that every affected cache key is included.

6. Cache Stampede Benchmark

The benchmark script is:

node scripts/stampede.mjs

The following results were reported by the earlier benchmark run:

Metric

Lock disabled

Lock enabled

Concurrent requests

200

200

Backend list queries

97

1

Successful requests

97

200

Failed requests

103

0

Duration

6,361.8 ms

282.7 ms

Database query counts were instrumented at the PostgreSQL list-query boundary.

With locking enabled, 200 concurrent requests required only one backend list query and all 200 requests succeeded. Without locking, the PostgreSQL connection limit was exceeded.

Conclusion: The locked benchmark met the stampede target. The unlocked failures demonstrate the risk of allowing concurrent cache misses to trigger independent database queries.

7. Empty-Result Caching

The source search identified these configured TTLs:

src/cache.mjs: default TTL of 300 seconds.

src/cacheWorkItemsResponse.mjs: TTL of 60 seconds.

A configured TTL alone does not prove that empty results are handled correctly.

Acceptance criterion still requiring verification: Confirm that empty arrays/results are either not cached or receive an intentionally short TTL, with the behavior documented and tested.

8. Automated Tests and Validation

The earlier implementation run reported:

npm test
13 tests passed
0 failures

Additional checks reported passing:

git diff --check

Node.js syntax checks

API validation against PostgreSQL and Redis

The API validation was rerun after restoring Elasticsearch access and passed on port 3000.

9. Remaining Work

Complete the audit of all cache-affecting mutation paths.

Verify empty-result caching behavior and add a test if necessary.

Verify Elasticsearch-backed API endpoints after restoring the Basic license.

Rerun npm test and the API validation after any final code changes.

Review git status and the diff before committing.

Suggested commit message after the acceptance criteria are satisfied:

Fix cache invalidation and prevent request stampedes

No commit or push was performed as part of this validation.

10. Final Status

PostgreSQL-backed CRUD fixes: implemented.

Redis cache integration and invalidation: implemented; full mutation audit pending.

Stampede protection: benchmark reported passing.

API validation: passed on port 3000.

Elasticsearch: running with an active Basic license.

Empty-result caching: requires final code-level verification.

Final acceptance: pending completion of the two cache audits and a final test run.

============================================================================================================================================================================================================================================================================================================================================================================================================================================================================================================================================================================================================
Day 18 — Build & Ship: Redis Locks and Rate Limiting

1. Run the automated test suite

# Command

// npm test

# Result

21 tests passed
0 tests failed

What this verifies

Lock acquisition and release.

Handling an already-held lock.

Redis errors and callback failures.

Owner-token verification during lock release.

Rate limiting and the 429 response.

Retry-After calculation.

Rate-limit key expiration and user isolation.

Concurrent requests exceeding the configured limit.

Some error logs appeared during the tests because certain tests intentionally simulate error conditions.

2. Verify mutual exclusion using two processes

# Command

// node scripts/prove-with-lock.mjs

# Result

A ENTER critical section pid=17779
B RESULT acquired=false pid=17780
A RESULT acquired=true pid=17779
PROOF PASSED: exactly one of two processes entered (proof:with-lock:0b495f0e-1c45-4e57-87c5-7c9d19a255f8)

What this proves

Two separate processes attempted to acquire the same lock. Process A acquired the lock and entered the critical section. Process B failed to acquire it while A held the lock.

Therefore, both processes did not enter the protected section simultaneously.

3. Verify the lock implementation

File

// src/withLock.mjs

Implementation details

Acquires a lock using Redis SET with NX and PX.

NX allows acquisition only if the lock key does not exist.

PX assigns the lock a TTL in milliseconds.

A unique token identifies the process that owns the lock.

A Lua script checks the token before deleting the lock.

Why release uses Lua

A normal GET followed by DEL is unsafe because these operations are separate.

For example:

Process A checks the lock and sees its own token.

A's lock expires.

Process B acquires the same lock.

Process A executes DEL and accidentally deletes B's lock.

Lua makes the ownership check and deletion atomic. The lock is deleted only if its stored token matches the releasing process's token.

Important limitation: If a lock holder crashes, the lock remains until its TTL expires. Redis then allows another process to acquire it. If the protected operation runs longer than the TTL, overlapping execution is possible; the TTL must be appropriate for the operation.

4. Verify the rate limiter's Redis Lua script

File

// src/rateLimitWorkItemCreate.mjs

Configuration

Maximum requests: 10
Window: 60,000 milliseconds (60 seconds)
Algorithm: Redis sorted set + Lua script

How it works

Removes request timestamps older than the 60-second window.

Counts the remaining requests.

If the count has reached 10, rejects the request.

Calculates the retry delay from the oldest remaining request.

Sets the key's expiry so the rate-limit data does not remain indefinitely.

Otherwise, records the new request and refreshes the key's expiry.

The Lua script performs the rate-limit decision and update atomically, preventing concurrent requests from independently passing the limit based on the same outdated count.

5. Verify the rate limiter directly against Redis

Command/result summary

The Redis Lua script was executed against the local Redis instance.

Result

Lua result: [ 1, 0 ]
Key type: zset
Member count: 1
TTL: 59998

What this proves

1 indicates that the request was allowed.

0 indicates no retry delay was needed.

The request was stored in a Redis sorted set (zset).

One request member was recorded.

The key had approximately 60 seconds of TTL remaining.

This verifies that the Redis script records requests and applies expiration.

6. Verify the live API rate limit

The application server was restarted before the final live API verification.

Test performed

Sent 11 rapid POST requests to:

POST /projects/3/work-items

The request titles followed this pattern:

DAY18_FINAL_VERIFY_1
DAY18_FINAL_VERIFY_2
...
DAY18_FINAL_VERIFY_11

Result

Requests 1–10: HTTP 201 Created
Request 11:    HTTP 429 Too Many Requests

The rejected response body was:

{
  "success": false,
  "errorCode": "RATE_LIMITED",
  "message": "Too many work-item creation requests. Try again later."
}

What this proves

The live API allowed the first 10 requests and rejected the 11th request within the configured window.

The rejected request did not create another work item.

Header verification note: The final live test captured the 429 response body, but it did not print the response headers. The implementation sets the Retry-After header, and the automated tests check the retry delay. Therefore, the live 429 behavior was verified, while the live header itself was not separately captured in this test.

7. Verify rate-limit middleware integration

File

src/routes/workItemRoutes.mjs

The work-item creation route applies middleware in this order:

Rate limiter
    ↓
Request validation
    ↓
Work-item controller

What this means

A request that exceeds the rate limit is rejected before validation and controller execution. It cannot proceed to the work-item creation logic.

The limiter is configured with the Redis client and identifies requests by authenticated user ID when available, falling back to the request IP.

8. Verify code formatting and whitespace

Command

git diff --check

Result

No output

What this proves

Git found no whitespace errors in the current diff.

9. Day 18 acceptance checklist

Requirement

Result

Two-process lock test proves mutual exclusion

Passed

Lock release checks ownership atomically using Lua

Implemented and tested

Rate limiter rejects excessive requests with HTTP 429

Passed in automated and live API tests

Retry-After is set on rejected requests

Implemented and covered by automated tests; live header not separately captured

Rate-limit keys expire

TTL behavior verified against Redis

Lock holder crash behavior is understood

Lock remains until TTL expiry

Automated tests

21 passed, 0 failed

Git diff validation

Passed

10. Final outcome

Day 18 implemented and tested Redis-based distributed locking and work-item creation rate limiting.

The two-process test demonstrated mutual exclusion. Lock release uses an atomic Lua ownership check, while the rate limiter uses an atomic Redis Lua script, a 10-request limit per 60-second window, HTTP 429 responses, retry-delay calculation, and key expiration.

The automated tests passed, the live API rejected the 11th rapid creation request, and git diff --check reported no issues.

Remaining verification detail: Capture the actual Retry-After response header from a live 429 response if a separate live-header proof is required.