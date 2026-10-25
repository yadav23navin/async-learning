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
# Day 18 — Build & Ship: Redis Locks and Rate Limiting

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

=========================================================================================================================================================================================================================================================================================================================================================================================================================================================

# Day 19 — RabbitMQ Event-Driven Email Notifications

Objective

Implement asynchronous email notifications in MiniTrack using RabbitMQ. The API publishes work-item events, a separate worker consumes them, and MailHog captures the test emails. Email delivery should not block the API request.

1. Install RabbitMQ and email dependencies

Installed the Node.js packages used for RabbitMQ messaging and email delivery.

npm install amqplib nodemailer

Result: Dependencies installed for RabbitMQ communication and SMTP email sending.

Checked Docker availability:

docker --version

Output:

Docker version 29.1.3

2. Configure RabbitMQ and MailHog

Created compose.yaml to run RabbitMQ with its management UI and MailHog for local email testing.

docker compose up -d

Result: Both containers started successfully.

minitrack-rabbitmq

minitrack-mailhog

Checked container status:

docker compose ps

Output:

NAME                 IMAGE                    SERVICE    STATUS
minitrack-mailhog    mailhog/mailhog:v1.0.1   mailhog    Up
minitrack-rabbitmq   rabbitmq:3-management    rabbitmq   Up (healthy)

The services expose these local ports:

RabbitMQ: 5672

RabbitMQ Management UI: 15672

MailHog SMTP: 1025

MailHog Web UI: 8025

Useful URLs:

RabbitMQ UI: http://localhost:15672

MailHog inbox: http://localhost:8025

3. Implement the RabbitMQ publisher

Created src/messaging/rabbitmq.mjs.

The publisher declares durable exchanges and queues, publishes persistent event messages, and waits for publisher confirmations.

Topology:

Express API
    |
    v
RabbitMQ Publisher
    |
    v
work_items.events (topic exchange)
    |
    +-- work_item.created
    |       |
    |       v
    |   work_item_created.email
    |
    +-- work_item.assigned
            |
            v
        work_item_assigned.email

The implementation also configures the dead-letter exchange work_items.dead and durable failed-message queues.

Each event contains:

eventId

eventType

occurredAt

data

The event ID is also used as the AMQP message ID.

4. Publish events from the work-item service

Updated src/services/workItemService.mjs to publish events after the work-item database operation and cache invalidation succeed.

Events implemented:

work_item.created

work_item.assigned

Creation event payload:

{
  work_item_id: created.id,
  project_id: created.project_id,
  title: created.title
}

Assignment event payload:

{
  work_item_id: workItem.id,
  project_id: workItem.project_id,
  title: workItem.title,
  assignee_id: workItem.assignee_id
}

Updated the work-item update path to accept assignee_id, and updated the repository to build a parameterized SQL update based on the supplied fields.

Updated src/server.mjs to connect the publisher during startup and inject it into the work-item service.

5. Update request validation

Updated src/workItemSchemas.mjs so that work-item updates accept an optional title or a positive integer assignee_id.

Both schemas use strict object validation, and an update must provide at least one supported field.

6. Implement the email worker

Created src/workers/emailWorker.mjs.

The worker:

Connects to RabbitMQ.

Declares the same exchanges, queues, bindings, and dead-letter configuration as the publisher.

Consumes both event queues.

Uses prefetch(1) to limit outstanding unacknowledged messages.

Sends email using Nodemailer and MailHog SMTP.

Acknowledges messages only after sendMail succeeds.

Rejects failed messages without requeue so RabbitMQ can route them to the dead-letter queue.

Added the npm script:

"worker:email": "node src/workers/emailWorker.mjs"

Verified the available scripts:

npm run

Relevant output:

start
  node src/server.mjs
test
  node --test test/*.test.mjs
dev
  node --watch src/server.mjs
worker:email
  node src/workers/emailWorker.mjs

7. Validate JavaScript syntax

Ran:

node --check src/workers/emailWorker.mjs
node --check src/messaging/rabbitmq.mjs

Result: Both syntax checks passed without errors.

8. Start the email worker

Ran:

npm run worker:email

Output:

> worker:email
> node src/workers/emailWorker.mjs

Email worker connected. Waiting for messages...

Conclusion: The worker connected to RabbitMQ and started listening for messages.

9. Start the API

In a separate terminal, ran:

npm run dev

Output:

> dev
> node --watch src/server.mjs

Redis connected
RabbitMQ publisher connected
Server running on port 3000

Conclusion: Redis and the RabbitMQ publisher connected successfully, and the API started on port 3000.

10. Find a valid project ID

Queried PostgreSQL to find existing projects:

SELECT id FROM projects ORDER BY id LIMIT 5;

Output:

[
  { id: '1' },
  { id: '2' },
  { id: '3' }
]

Used project ID 1 for the creation test.

11. Test the work-item creation event

Ran:

curl -i -X POST http://localhost:3000/projects/1/work-items \
  -H 'Content-Type: application/json' \
  -d '{"title":"Day 19 RabbitMQ email test"}'

Output:

HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8

Response body:

{
  "success": true,
  "workItem": {
    "id": "500339",
    "project_id": "1",
    "title": "Day 19 RabbitMQ email test",
    "description": null,
    "status": "todo",
    "priority": "medium",
    "created_at": "2026-10-20T18:30:59.187Z",
    "updated_at": "2026-10-20T18:30:59.187Z"
  }
}

The worker logged:

Email worker connected. Waiting for messages...
Email sent for work_item.created; event ID: 3722b914-9364-4a24-b01c-bd0c9cfb06ac

Conclusion: The API created the work item, RabbitMQ delivered the creation event, and the worker successfully processed it.

12. Find valid users for assignment

Queried the users table to inspect its columns.

SELECT column_name
FROM information_schema.columns
WHERE table_name = 'users'
ORDER BY ordinal_position;

Output:

id
name
email
created_at

Queried existing users:

SELECT id, name, email FROM users ORDER BY id LIMIT 5;

Output:

[
  { id: '1', name: 'Aarav', email: 'aarav1@minitrack.local' },
  { id: '2', name: 'Vivaan', email: 'vivaan2@minitrack.local' },
  { id: '3', name: 'Aditya', email: 'aditya3@minitrack.local' },
  { id: '4', name: 'Arjun', email: 'arjun4@minitrack.local' },
  { id: '5', name: 'Kabir', email: 'kabir5@minitrack.local' }
]

Used user ID 1 for the assignment test.

13. Test the work-item assignment event

Ran:

curl -i -X PATCH http://localhost:3000/work-items/500339 \
  -H 'Content-Type: application/json' \
  -d '{"assignee_id":1}'

The worker logged:

Email sent for work_item.assigned; event ID: 4f7db03d-c6cf-4c56-bb84-6e98262accac

Conclusion: The assignment event reached the worker and the email send operation succeeded.

The worker uses the configured test recipient (developer@example.test by default). The assigned user's email is not automatically looked up by the current worker implementation.

14. Run automated tests

Ran the existing test suite:

npm test

Relevant output:

✔ invalidation map targets affected key families
✔ a concurrent cold cache is filled once; distinct keys fetch independently
✔ expired locks can be recovered and an owner never releases another owner's lock
✔ failed backend reads are not cached and do not produce unhandled retries
✔ Redis read or lock failures fall back to exactly one backend fetch
✔ HTTP cache warms, hits, and invalidates after create, update, and delete
✔ invalid project and failed or missing writes do not invalidate cache
✔ failed database create does not invalidate cached data
✔ a committed write is explicit when cache invalidation fails
✔ wildcard invalidation scans and deletes all matching keys only
✔ wildcard invalidation follows multiple SCAN cursors before deleting
✔ lock acquires, invokes once, then releases
✔ held lock refuses a second callback
✔ Redis acquisition errors reject without running callback
✔ callback failure still releases lock
✔ old owner cannot delete a replaced lock; release script checks token atomically
✔ allows first ten, rejects the eleventh with sensible Retry-After, and leaves reads alone
✔ allows a request once an earlier request expires and isolates users
✔ concurrent creates never exceed ten
✔ PostgreSQL project repository awaits DB lookup and returns the database row
✔ PostgreSQL work-item create, lookup, update, and delete return rows

ℹ tests 21
ℹ suites 0
ℹ pass 21
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0

Conclusion: All 21 automated tests passed. Some AppError and simulated database/Redis error messages were printed by negative-path tests; they did not indicate test failures.

15. Day 19 concepts learned

Publisher confirmation is not email delivery

The API waits for RabbitMQ to confirm publication. It does not wait for the email worker to finish sending the email.

Manual acknowledgement

The worker acknowledges a message only after sendMail succeeds. This allows RabbitMQ to redeliver an unacknowledged message if the consumer disconnects before acknowledgement.

Dead-letter queues

Failed messages are rejected without requeue and routed to the configured dead-letter queues. This avoids an infinite retry loop for permanently failing messages.

API/database consistency

The database write and RabbitMQ publish are not one atomic transaction. If the database write succeeds but publication fails, the event may be lost. A transactional outbox is a stronger production approach.

Duplicate delivery

A message may be processed more than once under certain failure conditions. Production consumers should consider idempotency and deduplication.

Final Status

RabbitMQ and MailHog started successfully.

RabbitMQ publisher connected to the API.

Email worker connected and consumed messages.

work_item.created flow tested successfully.

work_item.assigned flow tested successfully.

Manual acknowledgements and prefetch configured.

Durable queues and dead-letter routing configured.

JavaScript syntax checks passed.

All 21 automated tests passed.

README updated with architecture, setup, testing, and reliability notes.

# Day 19 — Final Reliability and Performance Verification

16. Measure create-endpoint latency with notifications enabled

Ran an HTTP benchmark against the work-item creation endpoint with normal notification publishing enabled.

cd ~/Documents/async-learning && node --input-type=module <<'NODE'
const times = [];
const total = 8;

for (let i = 0; i < total; i++) {
  const start = performance.now();
  const response = await fetch("http://localhost:3000/projects/1/work-items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: `Day19 p95 test ${Date.now()}-${i}` })
  });

  const elapsed = performance.now() - start;
  const body = await response.text();

  if (!response.ok) {
    console.error(`Request ${i + 1} failed: HTTP ${response.status}`, body);
    process.exit(1);
  }

  times.push(elapsed);
}

times.sort((a, b) => a - b);
console.log(`Successful requests: ${times.length}/${total}`);
console.log(`Min: ${times[0].toFixed(2)} ms`);
console.log(`Median: ${times[Math.floor(times.length / 2)].toFixed(2)} ms`);
console.log(`p95 (nearest-rank): ${times[Math.ceil(0.95 * times.length) - 1].toFixed(2)} ms`);
console.log(`Max: ${times[times.length - 1].toFixed(2)} ms`);
NODE

Output:

Successful requests: 8/8
Min: 29.55 ms
Median: 31.30 ms
p95 (nearest-rank): 75.49 ms
Max: 75.49 ms

Note: The initial 30-request benchmark hit HTTP 429 because the endpoint allows 10 creations per minute per client IP. The successful benchmark was reduced to eight requests.

17. Measure baseline latency with event publishing disabled

Added a temporary benchmark switch in src/server.mjs:

const rabbitPublisher = createRabbitPublisher();
const notificationsEnabled =
    process.env.DISABLE_EVENT_PUBLISHING !== "1";

const workItemService = createWorkItemService({
    workItemRepository,
    projectRepository,
    publishEvent: notificationsEnabled
        ? rabbitPublisher.publish
        : async () => {}
});

Publisher startup was made conditional on the same flag.

Started the API without event publishing:

cd ~/Documents/async-learning && DISABLE_EVENT_PUBLISHING=1 npm start

Ran the same eight-request benchmark against the creation endpoint.

Output:

Successful requests: 8/8
Min: 26.49 ms
Median: 29.73 ms
p95 (nearest-rank): 107.88 ms
Max: 107.88 ms

Comparison

Metric

Notifications enabled

Publishing disabled

Successful requests

8

8

Median

31.30 ms

29.73 ms

p95

75.49 ms

107.88 ms

Maximum

75.49 ms

107.88 ms

Conclusion: The measurements do not establish that p95 is unchanged. The samples are too small and noisy to support that claim. A larger controlled benchmark with repeated runs is needed for a reliable comparison.

The implementation awaits RabbitMQ publisher confirmation in the work-item service. Consequently, the API response includes publication-confirmation latency, although it does not wait for the email worker to send the email.

18. Test worker crash and redelivery

Configured an optional processing delay in src/workers/emailWorker.mjs using WORKER_TEST_DELAY_MS. When set, the worker waits before parsing and processing a received message.

Started the worker in test mode:

cd ~/Documents/async-learning && WORKER_TEST_DELAY_MS=15000 npm run worker:email

Triggered an assignment update:

curl -i -X PATCH http://localhost:3000/work-items/500339 \
  -H 'Content-Type: application/json' \
  -d '{"assignee_id":2}'

The API returned:

HTTP/1.1 200 OK

After restarting the worker normally, the following log appeared:

Email sent for work_item.assigned; event ID: a968ea08-bde5-4bbb-b73f-43be65696160

Conclusion: An assignment event was processed after the worker restart. However, the test did not conclusively capture the same message being unacknowledged at the instant of the crash and then redelivered. The crash/redelivery acceptance criterion remains to be verified definitively.

19. Test RabbitMQ persistence across broker restart

Stopped the email worker so it could not consume the test message.

Published a persistent test event directly to the durable work_items.events exchange with routing key work_item.created. The event ID was:

broker-restart-test-1792523562306

Before restarting RabbitMQ, checked queue state:

docker exec minitrack-rabbitmq rabbitmqctl list_queues name messages_ready messages_unacknowledged

Relevant output:

name                         messages_ready  messages_unacknowledged
work_item_created.email      1               0

Restarted the broker:

docker restart minitrack-rabbitmq

After the restart, checked the queue again.

Relevant output:

name                         messages_ready  messages_unacknowledged
work_item_created.email      1               0

Started the email worker normally:

cd ~/Documents/async-learning && npm run worker:email

Output:

Email worker connected. Waiting for messages...
Email sent for work_item.created; event ID: broker-restart-test-1792523562306

Conclusion: Persistence test passed. The queued message survived the RabbitMQ restart and was subsequently processed by the email worker with the same event ID.

20. Final test suite

Ran:

npm test

Final test summary:

ℹ tests 21
ℹ suites 0
ℹ pass 21
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0

Conclusion: All 21 automated tests passed.

21. Final status

RabbitMQ and MailHog configured and started.

API publisher and email worker implemented.

work_item.created notification tested successfully.

work_item.assigned notification tested successfully.

Durable queues, persistent messages, manual acknowledgements, and prefetch(1) configured.

Dead-letter exchange and failed-message queues configured.

All 21 automated tests passed.

RabbitMQ restart persistence test passed with the same event ID confirmed after restart.

Worker crash/redelivery test attempted, but same-message redelivery still needs definitive verification.

API p95 measured with publishing enabled and disabled; results are inconclusive because the sample size was small.

Topology is documented, but its existence before coding has not been independently verified.

The API was restarted in normal mode with notification publishing enabled after the baseline test.

Overall outcome: The asynchronous email-notification feature is implemented and locally tested. RabbitMQ persistence is verified. Worker redelivery and the requirement that create-endpoint p95 remain unchanged still need stronger evidence before every acceptance criterion can be marked complete.

=========================================================================================================================================================================================================================================================================================================================================================================================================================================================

# Day 20 — Build / Ship: RabbitMQ Reliability Layer

Goal

Add retries with exponential backoff, a dead-letter queue (DLQ) after three attempts, and Redis-based idempotency to prevent duplicate emails when the same event is delivered more than once.

1. Environment verification

Redis, RabbitMQ, and MailHog were already installed.

RabbitMQ container: minitrack-rabbitmq

Redis container: redis-local

MailHog container: minitrack-mailhog

RabbitMQ management UI: http://localhost:15672

MailHog UI: http://localhost:8025

Redis connection: redis://localhost:6379

Started Redis and verified connectivity:

docker start redis-local
docker exec redis-local redis-cli ping

Expected output:

redis-local
PONG

Verified Node.js Redis connectivity:

node --input-type=module -e 'import { createClient } from "redis"; const r = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" }); r.on("error", e => console.error("Redis error:", e.message)); await r.connect(); console.log("Redis PING:", await r.ping()); await r.quit();'

Output:

Redis PING: PONG

2. Backed up the Day 19 worker

cp src/workers/emailWorker.mjs src/workers/emailWorker.day19.bak.mjs

Output:

Day 19 worker backed up

3. Implemented retry queues

Updated src/messaging/rabbitmq.mjs to configure durable retry queues for both email event types.

Retry queue

Message TTL

Purpose

work_item_created.email.retry.1

2,000 ms

First retry delay

work_item_created.email.retry.2

4,000 ms

Second retry delay

work_item_assigned.email.retry.1

2,000 ms

First retry delay

work_item_assigned.email.retry.2

4,000 ms

Second retry delay

After a retry queue's TTL expires, its dead-letter configuration routes the message back to the corresponding main queue.

The existing .failed queues remain the final destination for messages that fail three processing attempts.

4. Updated the email worker

Updated src/workers/emailWorker.mjs to implement:

A retry-count header named x-retry-count.

Three total processing attempts.

Exponential backoff of 2 seconds, followed by 4 seconds.

Persistent messages in the retry queues.

Manual acknowledgement after successful processing.

Dead-lettering after the third failed attempt.

Redis-based duplicate suppression using event IDs.

A Redis processing lock to reduce concurrent processing of the same event.

A test-only permanent failure switch: WORKER_ALWAYS_FAIL=1.

Redis keys used:

email:sent:<eventId> — records successful email processing for seven days.

email:processing:<eventId> — temporary processing lock with a 60-second expiry.

The worker checks the sent marker before sending. If the event has already been processed, it acknowledges the duplicate without sending another email.

5. Syntax and regression tests

Ran:

node --check src/messaging/rabbitmq.mjs
node --check src/workers/emailWorker.mjs
npm test

Results:

tests 21
pass 21
fail 0
cancelled 0
skipped 0
todo 0

Both syntax checks passed, and all 21 existing tests passed.

6. Permanent failure test

Started the worker in failure-injection mode:

WORKER_ALWAYS_FAIL=1 npm run worker:email

Published one persistent test event with the initial retry count set to zero.

Test event ID:

day20-failure-54144868-a3ee-4e51-b104-275791a239c1

The message was published to the work_items.events exchange using the work_item.created routing key.

Worker evidence

Processing work_item.created; event ID: day20-failure-54144868-a3ee-4e51-b104-275791a239c1; attempt 1/3
Attempt 1/3 failed for day20-failure-54144868-a3ee-4e51-b104-275791a239c1: Forced failure for Day 20 retry test
Retry scheduled; event ID: day20-failure-54144868-a3ee-4e51-b104-275791a239c1; next attempt 2; delay 2000ms
Processing work_item.created; event ID: day20-failure-54144868-a3ee-4e51-b104-275791a239c1; attempt 2/3
Attempt 2/3 failed for day20-failure-54144868-a3ee-4e51-b104-275791a239c1: Forced failure for Day 20 retry test
Retry scheduled; event ID: day20-failure-54144868-a3ee-4e51-b104-275791a239c1; next attempt 3; delay 4000ms
Processing work_item.created; event ID: day20-failure-54144868-a3ee-4e51-b104-275791a239c1; attempt 3/3
Attempt 3/3 failed for day20-failure-54144868-a3ee-4e51-b104-275791a239c1: Forced failure for Day 20 retry test
Sending to DLQ after 3 attempts

Result: PASSED

The same event ID appeared in all three attempts. The logged retry delays increased from 2,000 ms to 4,000 ms, and the third failure was sent to the DLQ.

7. Verified the DLQ

Ran:

docker exec minitrack-rabbitmq rabbitmqctl list_queues name messages_ready messages_unacknowledged

Relevant result:

work_item_created.email.failed  1  0

The DLQ contained exactly one ready message and zero unacknowledged messages.

8. Duplicate event test

Restarted the worker in normal mode:

npm run worker:email

Published the same event twice with the same event ID:

day20-duplicate-test-001

The test event title was:

Day 20 duplicate suppression test

Both copies were published successfully to RabbitMQ with the same event ID.

The worker logs confirmed that the first copy was processed and the duplicate was suppressed. MailHog was checked at http://localhost:8025; exactly one matching email was present.

Result: PASSED

Two copies of the same event produced only one email.

9. Final queue verification

Ran:

docker exec minitrack-rabbitmq rabbitmqctl list_queues name messages_ready messages_unacknowledged

Final output:

name                                  messages_ready  messages_unacknowledged
work_item_created.email.retry.2      0               0
work_item_assigned.email              0               0
work_item_assigned.email.retry.2      0               0
work_item_assigned.email.retry.1      0               0
work_item_created.email.failed        1               0
work_item_created.email               0               0
work_item_created.email.retry.1       0               0
work_item_assigned.email.failed       0               0

The one remaining DLQ message is the deliberately failing test event. All main and retry queues are empty, and no messages are unacknowledged.

10. Concepts learned

Retry count header: records the number of retries performed for an event.

Exponential backoff: delays retries progressively to avoid repeatedly hitting a failing dependency.

Delay queue: holds a message until its TTL expires, then routes it back to the main queue.

Dead-letter queue: stores messages that cannot be processed after the configured number of attempts.

Manual acknowledgement: tells RabbitMQ that a message has been handled.

Idempotency: ensures repeated processing of the same event does not repeat an already completed side effect.

Redis sent marker: records successful email processing and suppresses later duplicates.

Processing lock: helps prevent concurrent handling of the same event.

Failure injection: deliberately simulates a permanent error to prove retry and DLQ behavior.

Final status

Retry-count header implemented.

Exponential backoff implemented: 2 seconds, then 4 seconds.

Maximum of three processing attempts enforced.

Permanent failure test reached the DLQ after exactly three attempts.

DLQ message count verified.

Redis idempotency implemented.

Duplicate event test produced only one email in MailHog.

Main and retry queues verified empty after testing.

All 21 existing tests passed.

Day 20 reliability-layer tests completed.

Important limitation: Redis idempotency suppresses duplicates after a successful send has been recorded. It cannot guarantee exactly-once delivery across every crash window—for example, if SMTP accepts an email and the worker crashes before writing the Redis sent marker. A stronger design would require an idempotent email provider or a reconciliation strategy for that failure window.

=========================================================================================================================================================================================================================================================================================================================================================================================================================================================

# Day 21 — Build/Ship: Async Observability & Load Testing

Date: 22 October 2026
Project: async-learning

Goal

Ship the RabbitMQ notification workflow with correlation IDs, observable queue/worker metrics, a 10,000-event load test, and updated documentation.

1. Start the email worker

Command

cd ~/Documents/async-learning && npm run worker:email

Observed output

> worker:email
> node src/workers/emailWorker.mjs

[queue-depth] work_item_created.email: ready=0
[queue-depth] work_item_created.email.retry.1: ready=0
[queue-depth] work_item_created.email.retry.2: ready=0

The worker starts and reports queue depths. Additional queue-depth and DLQ-depth logs are emitted during operation.

2. Test the work-item assignment event

Command

curl -sS -X PATCH http://localhost:3000/work-items/1 \
  -H 'Content-Type: application/json' \
  -d '{"assignee_id":1}'

Result

{
  "success": true,
  "workItem": {
    "id": "1",
    "project_id": "1",
    "title": "Writer A edit",
    "status": "done",
    "priority": "high",
    "assignee_id": "1",
    "created_at": "2026-09-23T06:12:10.831Z",
    "updated_at": "2026-10-22T06:53:03.310Z"
  }
}

The API successfully updated the work item. The worker processed the assignment event.

Worker output

Processing work_item.assigned; event ID: a787e0d6-95db-45f7-8620-a6412aeb4f6d; correlation ID: e88b4219-a3e5-4785-b0eb-2e7bb579330b; attempt 1/3
Assignment email skipped; preference disabled for user 1
Event processed; event ID: a787e0d6-95db-45f7-8620-a6412aeb4f6d; correlation ID: e88b4219-a3e5-4785-b0eb-2e7bb579330b; attempt 1

What this verifies

The event has an event ID and correlation ID.

The worker logs the same correlation ID when processing and completing the event.

The assignment email was skipped because the user's notification preference was disabled.

Remaining verification: The matching API-side event_published log was not captured, so a live publisher-to-worker correlation ID match remains unverified.

3. Inspect correlation ID publishing code

Command

cd ~/Documents/async-learning && \
grep -n -C 4 'event_published\|correlationId' src/messaging/rabbitmq.mjs

Relevant output

89:        const eventId = randomUUID();
90:        const correlationId = randomUUID();

92:        channel.publish(
...
96:                eventId,
97:                correlationId,
98:                eventType,
...
105:                messageId: eventId,
106:                correlationId,
...
111:        await channel.waitForConfirms();
112:        console.log(JSON.stringify({
113:            event: "event_published",
114:            eventId,
115:            correlationId,
116:            eventType
117:        }));

Result: The publisher generates a correlation ID, includes it in the message body and AMQP properties, waits for RabbitMQ publisher confirms, and then logs the event.

4. Check whether publisher logs were saved to files

Command

cd ~/Documents/async-learning && \
grep -n 'event_published' logs/*.log 2>/dev/null | tail -10

Result

(no output)

No matching log lines were found in logs/*.log. The publisher logs may be going to the API terminal instead.

5. Inspect runtime metrics

Command

curl -s http://localhost:3000/metrics

Observed output

{
  "queueDepths": {
    "work_item_created.email": 0,
    "work_item_created.email.retry.1": 0,
    "work_item_created.email.retry.2": 0,
    "work_item_created.email.failed": 1,
    "work_item_assigned.email": 0,
    "work_item_assigned.email.retry.1": 0,
    "work_item_assigned.email.retry.2": 0,
    "work_item_assigned.email.failed": 1,
    "total": 2
  },
  "processedCount": 6,
  "failureCount": 0
}

Result

Main and retry queues had zero ready messages at the time of this snapshot.

Total ready messages across the reported queues: 2.

Processed count: 6.

Failure count: 0.

Each of the two failed-message queues contained one ready message.

These are runtime snapshots, not permanent totals.

6. Clean up the previous load-test queue

An earlier load-test run had accidentally accumulated 20,000 ready messages. The dedicated test queue was deleted before the final run.

Command

docker exec minitrack-rabbitmq rabbitmqctl delete_queue day21.loadtest

Result

Queue was successfully deleted with 20000 ready messages

This removed the old test queue and its accumulated messages. The final load test was then run against a fresh queue.

7. Run the 10,000-event RabbitMQ load test

Command

cd ~/Documents/async-learning && \
node scripts/load-rabbitmq-10k.mjs

Final successful output

{
  "published": 10000,
  "requested": 10000,
  "elapsedSeconds": 0.53,
  "throughputEventsPerSecond": 18793,
  "peakQueueDepth": 10000,
  "publishFailures": 0,
  "queue": "day21.loadtest"
}

Results

Measurement

Result

Events requested

10,000

Events published

10,000

Elapsed time

0.53 seconds

Throughput

18,793 events/second

Peak queue depth

10,000

Publish failures

0

Queue

day21.loadtest

Interpretation: All 10,000 messages were published successfully in the measured run. The dedicated queue reached a peak depth of 10,000 because no worker was consuming its load-test messages. This measured publish throughput, not email delivery or end-to-end processing throughput.

The test queue may still contain the 10,000 messages from this run.

8. Run automated tests

Command

cd ~/Documents/async-learning && npm test

Result

21 tests passed
0 tests failed

Some tests printed error stack traces for simulated failures. The test suite still completed successfully.

9. Update README documentation

The README was updated to document:

Bounded retries with 2-second and 4-second backoff.

A maximum of three processing attempts.

Dead-letter handling for failed messages.

Redis idempotency keys and processing locks.

Assignment notification preference lookup, with database fallback.

The /metrics endpoint.

The 10,000-event load-test command and measured results.

Load-test documentation

Events published:       10,000
Elapsed time:           0.53 seconds
Throughput:              18,793 events/second
Peak queue depth:        10,000
Publish failures:        0

The topology documentation should also show the retry queues:

work_items.events (topic exchange)
    ├── work_item_created.email
    │     ├── work_item_created.email.retry.1
    │     ├── work_item_created.email.retry.2
    │     └── work_item_created.email.failed
    │
    └── work_item_assigned.email
          ├── work_item_assigned.email.retry.1
          ├── work_item_assigned.email.retry.2
          └── work_item_assigned.email.failed

work_items.dead (dead-letter exchange)

Confirm the final README diagram reflects the actual bindings before treating the topology documentation as fully verified.

=========================================================================================================================================================================================================================================================================================================================================================================================================================================================

# Day 22 — Daily Digest Job

BUILD / SHIP

Goal

Build a daily digest job that sends each user one summary email at 09:00 IST when they have open work items due tomorrow. Use a Redis lock to prevent concurrent runs, support manual execution and dry-run mode, and record job results in PostgreSQL.

Implementation

Added migrations/005_daily_digest.sql.

Added due_date to work_items.

Added a partial index for open work items with an assignee and due date.

Added digest_job_runs to track job start/finish times, users processed, emails sent, errors, status, and error details.

Added src/repositories/digestRepository.mjs.

Finds users with open items due tomorrow.

Creates and finishes database run records.

Added src/dailyDigest.mjs.

Uses Asia/Kolkata for scheduling at 09:00 IST.

Checks every 30 seconds.

Uses a Redis lock to prevent simultaneous execution.

Uses a Redis completion marker to skip a successfully completed scheduled date.

Sends summary emails through Nodemailer.

Supports --once and --dry-run.

Added package scripts:

npm run digest

npm run digest:once

Terminal Commands and Results

1. Check available npm scripts

Command:
npm run

Result:

digest — starts the daily scheduler.

digest:once — runs the digest manually once.

2. Check JavaScript syntax

Command:
node --check src/dailyDigest.mjs

Result:

Passed with no syntax errors.

3. Dry-run test

Command:
node src/dailyDigest.mjs --once --dry-run

Observed output:

[digest] run=3 dueDate=2026-10-24 users=1 dryRun=true
[digest] DRY RUN user=1 email=aarav1@minitrack.local items=1
[digest] finished run=3 status=success users=1 emails=0 errors=0

Result:

Found one user with one open item due tomorrow.

Printed the recipient and item count.

Sent zero emails.

4. Manual email test

Command:
npm run digest:once

Observed output:

[digest] run=4 dueDate=2026-10-24 users=1 dryRun=false
[digest] email sent user=1 items=1
[digest] finished run=4 status=success users=1 emails=1 errors=0

Result:

Processed one user.

Sent one email.

Had zero errors.

Confirmed the email arrived in MailHog at http://localhost:8025.

5. Simultaneous-instance test

Command:
npm run digest:once & npm run digest:once & wait

Observed output:

[digest] another process holds the lock; skipping tick
[digest] run=5 dueDate=2026-10-24 users=1 dryRun=false
[digest] email sent user=1 items=1
[digest] finished run=5 status=success users=1 emails=1 errors=0

Result:

One process acquired the Redis lock and sent one email.

The other process skipped because the lock was held.

Exactly one email was sent across the two simultaneous processes.

6. Verify timezone conversion with UTC server timezone

Command:
TZ=UTC node --input-type=module -e "const d=new Date('2026-10-23T03:30:00Z'); console.log('Server timezone:',Intl.DateTimeFormat().resolvedOptions().timeZone); console.log('IST time:',new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d));"

Observed output:

Server timezone: UTC
IST time: 09:00

Result:

Confirmed that 03:30 UTC converts to 09:00 in Asia/Kolkata.

This checked timezone conversion; it did not by itself execute the scheduler.

7. Test scheduled idempotency under a simulated clock

A temporary Node.js preload simulated 2026-10-23T03:30:00Z, equivalent to 09:00 IST. A temporary Redis marker was set for the test date, then the scheduler was started with TZ=UTC.

Observed output:

OK
[digest] scheduler started; daily schedule 09:00 Asia/Kolkata; dryRun=false
[digest] 2026-10-23 already completed; skipping
(integer) 1

Result:

The scheduler reached the 09:00 IST path while the process timezone was UTC.

The completion marker caused the scheduled run to skip.

The final (integer) 1 confirmed that the temporary Redis marker was deleted.

No email was sent by this idempotency test.

Final Result

The daily digest job is implemented. Dry-run behavior, manual email delivery, concurrent-run locking, timezone conversion, and scheduled completion-marker skipping were verified.

A real scheduled execution at 09:00 IST on a live clock has not yet been observed.

=========================================================================================================================================================================================================================================================================================================================================================================================================================================================

# Day 23 — Resumable Elasticsearch Backfill

BUILD / SHIP

1. Create a backup of the original script

Command

cp scripts/backfill.mjs scripts/backfill.mjs.bak

Result

Created a backup of the original backfill script at scripts/backfill.mjs.bak.

2. Check JavaScript syntax

Command

node --check scripts/backfill.mjs

Result

No output.

Syntax check passed.

3. Run the dry-run preview

Command

ES_PASSWORD='ePS5j28X' node scripts/backfill.mjs --limit=1000

Observed output

Cluster: docker-cluster
Index: work_items
Mode: DRY RUN
Limit: 1000
Batch size: 100
Documents missing points: 500300
Eligible for this run: 1000

Five sample documents were previewed.

No documents were modified during the dry run.

4. Test a small backfill of 100 documents

Command

ES_PASSWORD='ePS5j28X' node scripts/backfill.mjs --limit=100 --apply

Confirmation entered

APPLY docker-cluster/work_items

Result

Updated: 100
Failures: 0

Checkpoint created at .backfill/points-zero.json.

5. Checkpoint protection when changing the run limit

Command

ES_PASSWORD='ePS5j28X' node scripts/backfill.mjs --limit=1000 --apply

Result

The script refused to start because an existing checkpoint was present.

The checkpoint needed to be moved before starting a separate job with a different limit.

6. Move the earlier checkpoint aside

Command

mv .backfill/points-zero.json .backfill/points-zero-test100.json

Result

Preserved the checkpoint from the 100-document test under a different filename.

7. Test stopping after 400 documents

Command

ES_PASSWORD='ePS5j28X' node scripts/backfill.mjs --limit=1000 --stop-after=400 --apply

Confirmation entered

APPLY docker-cluster/work_items

Observed result

Job ID: cab00433-b4ac-436e-9dcf-798525670bef
Updated: 400
Skipped: 0
Failures: 0
Stopped: true
Checkpoint saved

The script stopped at the configured batch boundary.

Progress was saved in .backfill/points-zero.json.

8. Resume the first controlled-stop job

Command

ES_PASSWORD='ePS5j28X' node scripts/backfill.mjs --limit=1000 --resume --apply

Confirmation entered

APPLY docker-cluster/work_items

Result

Resumed from the saved checkpoint.

Continued from 400 toward the 1,000-document limit.

Completed 1,000 updates in total.

Zero skipped and zero failed updates.

9. Move completed checkpoints aside before separate jobs

These checkpoint moves were performed to allow new independent runs without overwriting or reusing the previous completed job's checkpoint.

Commands

mv .backfill/points-zero.json .backfill/points-zero-completed1000.json

mv .backfill/points-zero.json .backfill/points-zero-completed1000b.json

mv .backfill/points-zero.json .backfill/points-zero-completed1000c.json

Result

Preserved the completed checkpoints under separate filenames.

10. Additional 1,000-document apply runs

The following command was run for separate 1,000-document jobs:

ES_PASSWORD='ePS5j28X' node scripts/backfill.mjs --limit=1000 --apply

Confirmation entered each time

APPLY docker-cluster/work_items

Observed results

Job d0dba942-4d46-4234-a324-d48d02f348f7: completed 1,000 updates, zero failures.

Job e21c381e-af85-402a-84f5-5290482e3412: completed 1,000 updates, zero failures.

The script completed too quickly for the attempted manual Ctrl+C interruption tests.

11. Check an already completed checkpoint

Command

ES_PASSWORD='ePS5j28X' node scripts/backfill.mjs --limit=1000 --resume --apply

Result

The script recognized that the corresponding job had already reached 1,000 updates.

No additional updates were needed for that completed job.

12. Repeat the controlled stop/resume test

Command

ES_PASSWORD='ePS5j28X' node scripts/backfill.mjs --limit=1000 --stop-after=400 --apply

Confirmation entered

APPLY docker-cluster/work_items

Observed output

Job ID: c2c354cf-5ff6-4ec7-8763-0bfdfb030778
Updated: 400
Skipped: 0
Failures: 0
Stopped: true
Checkpoint saved

13. Resume the same job

Command

ES_PASSWORD='ePS5j28X' node scripts/backfill.mjs --limit=1000 --resume --apply

Confirmation entered

APPLY docker-cluster/work_items

Observed result

Same job ID: c2c354cf-5ff6-4ec7-8763-0bfdfb030778
Previously completed: 400
Resumed through: 500
Resumed through: 600
Resumed through: 700
Resumed through: 800
Resumed through: 900
Resumed through: 1000
Total updated: 1000
Skipped: 0
Failures: 0
Stopped: false

The same job ID was retained.

The checkpoint allowed the job to continue from 400 rather than starting a new job.

The controlled stop/resume test passed.

14. Verify the Elasticsearch document counts

Command

ES_PASSWORD='ePS5j28X' node --input-type=module -e 'import es from "./src/elasticsearchClient.mjs"; try { console.log(JSON.stringify({missingPoints:(await es.count({index:"work_items",query:{bool:{must_not:[{exists:{field:"points"}}]}}})).count,zeroPoints:(await es.count({index:"work_items",query:{term:{points:0}}})).count},null,2)); } finally { await es.close(); }'

Observed output from the earlier verification

{
  "missingPoints": 499200,
  "zeroPoints": 1100
}

Interpretation:

missingPoints counts documents that still do not have a points field.

zeroPoints counts documents whose points value is 0.

This verification was performed after the initial 100-document test and the first 1,000-document job.

The last controlled stop/resume run started when the missing count was observed at 495800 and updated another 1,000 documents. The expected missing count afterward is 494800; a fresh verification after that final run was not recorded in the available output.

15. Update the project log

Command

cat >> log.md <<'EOF'

# Day 23 — Resumable Elasticsearch Backfill

## BUILD / SHIP

### Implemented
- Created reusable `scripts/backfill.mjs`.
- Added dry-run preview and explicit confirmation before writes.
- Added target-cluster validation for `docker-cluster`.
- Added batches of 100 documents.
- Added checkpoint persistence in `.backfill/points-zero.json`.
- Added `--limit`, `--apply`, `--resume`, and `--stop-after` options.
- Updated missing `points` values to `0` in the `work_items` index.

### Tests
- `node --check scripts/backfill.mjs`: passed.
- Dry run: found 500,300 documents missing `points`; previewed five sample documents without modifying data.
- 100-document test: 100 updated, zero failures.
- Additional 1,000-document jobs: completed with zero failures.
- Controlled stop: stopped at 400 updates and saved a checkpoint.
- Resume: continued the same job from 400 to 1,000 updates, with zero skipped and zero failed updates.
- Elasticsearch count verification observed 499,200 missing `points` and 1,100 documents with `points: 0` after the initial test and first 1,000-document job.

### Notes
- Multiple independent 1,000-document jobs were run during testing.
- The controlled stop/resume workflow passed.
- An actual Ctrl+C/process-kill interruption was not demonstrated.
- The entire index has not been backfilled; remaining documents still need processing if a full-index backfill is required.

### Additional Tests — Final Completion

#### 16. Test actual Ctrl+C interruption

Command

printf 'APPLY docker-cluster/work_items\n' | timeout --signal=INT --kill-after=5s 5s env ES_PASSWORD='ePS5j28X' BACKFILL_CHECKPOINT=.backfill/points-zero-sigint-test.json BACKFILL_DELAY_MS=1000 node scripts/backfill.mjs --limit=1000 --apply

Observed result

- Job ID: cb82c022-5610-4b0c-a631-a57017e24218
- Updated before interruption: 300
- Skipped: 0
- Failures: 0
- Ctrl+C was received.
- The script stopped safely after the current batch.
- Checkpoint was saved to `.backfill/points-zero-sigint-test.json`.

Result: Passed. The interruption handler safely stopped the job and preserved its progress.

#### 17. Resume after actual Ctrl+C

Command

printf 'APPLY docker-cluster/work_items\n' | env ES_PASSWORD='ePS5j28X' BACKFILL_CHECKPOINT=.backfill/points-zero-sigint-test.json node scripts/backfill.mjs --limit=1000 --resume --apply

Observed result

- Same job ID: cb82c022-5610-4b0c-a631-a57017e24218
- Previously completed: 300 updates
- Resumed from 300 and continued through 400, 500, 600, 700, 800, 900, and 1,000.
- Total updated: 1,000
- Skipped: 0
- Failures: 0
- Stopped: false

Result: Passed. The job resumed from its saved checkpoint rather than restarting from zero.

#### 18. Verify completed-checkpoint behavior

Command

printf 'APPLY docker-cluster/work_items\n' | env ES_PASSWORD='ePS5j28X' BACKFILL_CHECKPOINT=.backfill/points-zero-sigint-test.json node scripts/backfill.mjs --limit=1000 --resume --apply

Observed output

Resuming job cb82c022-5610-4b0c-a631-a57017e24218; successful updates so far: 1000.
Requested update limit already reached.

Result: Passed. The completed job performed no additional updates.

Note: This verifies completed-checkpoint behavior, not a fresh independent rerun. A fresh job can process other documents that still lack `points`.

#### 19. Final verification status

- Dry-run safety: passed.
- Explicit write confirmation and target-cluster validation: passed.
- Batch processing and checkpoint persistence: passed.
- Controlled stop/resume using `--stop-after=400`: passed.
- Actual Ctrl+C interruption and resume: passed.
- Completed-checkpoint no-op: passed.
- The latest recorded pre-run count was 492,900 documents missing `points`. The subsequent resumed job updated 700 documents, so the expected missing count afterward is 492,200.
- A fresh Elasticsearch count query after the final run was not recorded.
- The full index has not been backfilled; this task intentionally used bounded test runs.

=========================================================================================================================================================================================================================================================================================================================================================================================================================================================

# Day 25 — Elasticsearch Activity Timestamp Migration

BUILD / SHIP

1. Check the migration script syntax

Command

node --check scripts/backfill-last-activity.mjs

Output

No output — syntax check passed.

What it means: Node checked the JavaScript syntax without executing the migration or changing Elasticsearch data.

2. First migration attempt — authentication failure

Command

node scripts/backfill-last-activity.mjs

Output

Migration failed: ResponseError: security_exception
security_exception: missing authentication credentials for REST request [/]
status: 401

What happened: Elasticsearch requires authentication. The script's Elasticsearch client reads the password from ES_PASSWORD, which was not set in that terminal.

3. Run the migration with authentication

Command

ES_PASSWORD='<your-local-ES-password>' node scripts/backfill-last-activity.mjs

Observed output

Processed 500000; updated 500000

=== Scan + bulk summary ===
{
  "beforeCount": 500300,
  "afterCount": 500300,
  "processed": 500300,
  "updated": 500300,
  "elapsedSeconds": 77.3,
  "searchLoad": {
    "requests": 720,
    "errors": 0,
    "p50_ms": 6.13,
    "p95_ms": 10.96,
    "max_ms": 217.99
  }
}

What it means:

beforeCount and afterCount are equal, so the migration did not change the number of documents.

All 500,300 documents were processed and updated.

The migration took 77.3 seconds.

The search load generator ran alongside the migration.

All 720 search requests succeeded.

Search p95 latency during the migration was 10.96 ms.

How the scan + bulk approach works:

Read a batch of documents from Elasticsearch.

Collect their work_item_id values.

Query PostgreSQL for each work item's latest activity using MAX(created_at).

Build bulk update operations.

Write last_activity_at to Elasticsearch.

Continue until all documents are processed.

The new field stores the latest related activity timestamp. Items without activities receive null.

4. Verify the new field is populated

Command

curl -s -u 'elastic:<your-local-ES-password>' \
  -X POST 'http://localhost:9200/work_items_v2/_count' \
  -H 'Content-Type: application/json' \
  -d '{"query":{"exists":{"field":"last_activity_at"}}}'

Output

{
  "count": 500000,
  "_shards": {
    "total": 1,
    "successful": 1,
    "skipped": 0,
    "failed": 0
  }
}

What it means: 500,000 documents have a non-null last_activity_at. Elasticsearch's exists query does not count fields whose value is null.

5. Find documents with a missing timestamp

Command

curl -s -u 'elastic:<your-local-ES-password>' \
  -X POST 'http://localhost:9200/work_items_v2/_search' \
  -H 'Content-Type: application/json' \
  -d '{"size":5,"query":{"bool":{"must_not":[{"exists":{"field":"last_activity_at"}}]}},"_source":["work_item_id","last_activity_at"]}'

Observed output — relevant fields

{
  "hits": {
    "total": {
      "value": 300,
      "relation": "eq"
    },
    "hits": [
      {
        "_id": "500001",
        "_source": {
          "work_item_id": "500001",
          "last_activity_at": null
        }
      }
    ]
  }
}

What it means: 300 documents have a null timestamp. The response showed these fields for the sample document. The complete response contained five sample hits.

6. Verify those 300 items in PostgreSQL

First attempt

PGPASSWORD='<your-PostgreSQL-password>' psql -h localhost -U minitrack -d minitrack -c "SELECT COUNT(DISTINCT w.work_item_id) AS missing_items_with_activities FROM work_items w JOIN activities a ON a.work_item_id = w.work_item_id WHERE w.work_item_id BETWEEN 500001 AND 500300;"

Output

ERROR: column w.work_item_id does not exist
HINT: Perhaps you meant to reference the column "a.work_item_id".

What happened: The PostgreSQL work_items table uses id as its primary key, not work_item_id.

Corrected command

PGPASSWORD='<your-PostgreSQL-password>' psql -h localhost -U minitrack -d minitrack -c "SELECT COUNT(DISTINCT w.id) AS missing_items_with_activities FROM work_items w JOIN activities a ON a.work_item_id = w.id WHERE w.id BETWEEN 500001 AND 500300;"

Output

 missing_items_with_activities
--------------------------------
                              0
(1 row)

What it means: None of the 300 work items in the checked ID range has a matching activity row. Their null timestamps are expected.

Final field-population summary

Total documents: 500,300

Documents with a timestamp: 500,000

Documents without a timestamp: 300

Verified missing items with activities: 0

7. Benchmark Elasticsearch update_by_query with Painless

Command

time curl -s -u 'elastic:<your-local-ES-password>' \
  -X POST 'http://localhost:9200/work_items_v2/_update_by_query?refresh=true&conflicts=proceed' \
  -H 'Content-Type: application/json' \
  -d '{"query":{"match_all":{}},"script":{"lang":"painless","source":"ctx.op = \"noop\""}}'

Observed output

{
  "took": 8831,
  "timed_out": false,
  "total": 500300,
  "updated": 0,
  "deleted": 0,
  "batches": 501,
  "version_conflicts": 0,
  "noops": 500300,
  "retries": {
    "bulk": 0,
    "search": 0
  },
  "throttled_millis": 0,
  "requests_per_second": -1.0,
  "throttled_until_millis": 0,
  "failures": []
}

Shell timing

real    0m8.897s
user    0m0.012s
sys     0m0.006s

What it means:

Elasticsearch scanned 500,300 documents.

The Painless script set ctx.op = "noop", telling Elasticsearch not to modify the document.

All 500,300 documents were no-ops.

The operation took about 8.9 seconds.

There were no version conflicts or reported failures.

Important limitation: Painless cannot query the PostgreSQL activities table. This benchmark measures Elasticsearch-side scanning and script execution only. It does not calculate or populate the latest activity timestamp, so it is not equivalent to the scan + bulk migration.

8. Search latency comparison

The baseline was measured before the migration.

Metric

Baseline

During scan + bulk

p50

Not recorded in the available baseline results

6.13 ms

p95

12.28 ms

10.96 ms

Maximum

88.97 ms

217.99 ms

Search errors

Not recorded in the available baseline results

0

Interpretation:

Baseline p95 was 12.28 ms.

During the migration, p95 was 10.96 ms.

The observed p95 decreased by 1.32 ms in this run.

The maximum request latency reached 217.99 ms, so occasional slower requests still occurred.

Search latency was not measured during the Painless no-op benchmark.

This result applies to the measured run only; it does not guarantee that every workload will behave the same way.

9. Migration plan and estimated versus actual time

Initial estimated total time: 50–160 minutes.

Planned steps:

Inspect the mapping, PostgreSQL activity relationship, and search endpoint.

Add the last_activity_at mapping.

Implement scan + bulk migration.

Benchmark Painless update_by_query where applicable.

Verify document count and timestamp population.

Measure search latency during the migration.

Record the results.

Actual scan + bulk execution time: 77.3 seconds, or approximately 1 minute 17 seconds.

The scan + bulk execution was substantially faster than the initial estimate. The 77.3-second figure is the measured migration runtime, not the total time spent planning, troubleshooting, and documenting.

# Day 24 — Elasticsearch Activity Timestamp Migration (Final Results)

1. Add the temporary staging field mapping

Command:

curl -s -u 'elastic:ePS5j28X' -X PUT 'http://localhost:9200/work_items_v2/_mapping' -H 'Content-Type: application/json' -d '{"properties":{"last_activity_at_stage":{"type":"date","format":"epoch_millis"}}}'

Expected successful response:

{"acknowledged":true}

Note: An initial attempt returned HTTP 401 because the password placeholder was used literally. The corrected command was then used.

2. Create the staging script

Command:

cp scripts/backfill-last-activity.mjs scripts/stage-last-activity.mjs

Change the output field in the copied script:

sed -i 's/last_activity_at:/last_activity_at_stage:/g' scripts/stage-last-activity.mjs

The original migration script remains unchanged.

3. Run the staging scan + bulk operation

Command:

ES_PASSWORD='ePS5j28X' node scripts/stage-last-activity.mjs

Actual output:

Processed 500000; updated 500000

=== Scan + bulk summary ===
{
  "beforeCount": 500300,
  "afterCount": 500300,
  "processed": 500300,
  "updated": 500300,
  "elapsedSeconds": 66.98,
  "searchLoad": {
    "requests": 628,
    "errors": 0,
    "p50_ms": 5.39,
    "p95_ms": 9.54,
    "max_ms": 201.32
  }
}

Results:

Processed: 500,300 documents

Updated: 500,300 documents

Runtime: 66.98 seconds

Search requests: 628

Search errors: 0

Search p95 latency: 9.54 ms

4. Copy staged timestamps using Painless

Command:

curl -s -u 'elastic:ePS5j28X' -X POST 'http://localhost:9200/work_items_v2/_update_by_query?refresh=true&conflicts=proceed' -H 'Content-Type: application/json' -d '{"query":{"match_all":{}},"script":{"lang":"painless","source":"if (ctx._source.containsKey(\"last_activity_at_stage\")) { ctx._source.last_activity_at = ctx._source.last_activity_at_stage; ctx._source.remove(\"last_activity_at_stage\"); } else { ctx.op = \"noop\"; }"}}'

Actual output:

{
  "took": 24614,
  "timed_out": false,
  "total": 500300,
  "updated": 500300,
  "deleted": 0,
  "batches": 501,
  "version_conflicts": 0,
  "noops": 0,
  "retries": {
    "bulk": 0,
    "search": 0
  },
  "throttled_millis": 0,
  "requests_per_second": -1.0,
  "failures": []
}

Results:

Documents updated: 500,300

Elasticsearch-reported runtime: 24.614 seconds

Version conflicts: 0

No-ops: 0

Failures: 0

The script copied the staged values into last_activity_at and removed last_activity_at_stage.

5. Verify the temporary staging field was removed

Command:

curl -s -u 'elastic:ePS5j28X' -X POST 'http://localhost:9200/work_items_v2/_count' -H 'Content-Type: application/json' -d '{"query":{"exists":{"field":"last_activity_at_stage"}}}'

Actual output:

{
  "count": 0,
  "_shards": {
    "total": 1,
    "successful": 1,
    "skipped": 0,
    "failed": 0
  }
}

Result: No documents have the temporary staging field.

6. Verify the final timestamp field

Command:

curl -s -u 'elastic:ePS5j28X' -X POST 'http://localhost:9200/work_items_v2/_count' -H 'Content-Type: application/json' -d '{"query":{"exists":{"field":"last_activity_at"}}}'

Actual output:

{
  "count": 500000,
  "_shards": {
    "total": 1,
    "successful": 1,
    "skipped": 0,
    "failed": 0
  }
}

Result: Exactly 500,000 documents have last_activity_at.

The other 300 documents have no activity timestamp. A previous PostgreSQL verification found zero items with IDs 500001–500300 that had related activity rows.

7. Performance comparison

Operation

Documents

Runtime

Approx. throughput

Original scan + bulk

500,300

77.30 s

6,472 docs/s

Staging scan + bulk

500,300

66.98 s

7,470 docs/s

Painless final update

500,300

24.614 s

20,323 docs/s

Throughput is calculated as documents divided by elapsed seconds. The Painless runtime is Elasticsearch's reported took value, so the figures are approximate and not a fully controlled benchmark.

Original scan + bulk search-load measurements:

Baseline before migration: p50 9.01 ms, p95 12.28 ms, max 88.97 ms across 100 requests.

During original migration: 720 requests, 0 errors, p50 6.13 ms, p95 10.96 ms, max 217.99 ms.

During staging: 628 requests, 0 errors, p50 5.39 ms, p95 9.54 ms, max 201.32 ms.

8. ETA estimate versus actual runtime

Initial ETA estimate: 50–160 minutes for the overall task, including investigation, implementation, verification, benchmarking, and documentation.

Original migration execution: 77.30 seconds.

Staging execution: 66.98 seconds.

Painless final update: 24.614 seconds.

The 77.30-second migration runtime is only the execution time, not the total time spent completing the entire task.

9. Important implementation note

This second approach is a hybrid PostgreSQL + scan/bulk + Painless workflow, not a standalone Painless-only migration. Painless cannot directly query PostgreSQL; the staging script first retrieves the timestamps and writes them into Elasticsearch, after which Painless performs the final field copy and cleanup.

A previous Painless no-op benchmark processed 500,300 documents in approximately 8.897 seconds, but it did not migrate any data and must not be presented as a completed migration.

