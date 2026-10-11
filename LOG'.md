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