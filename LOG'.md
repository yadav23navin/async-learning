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

