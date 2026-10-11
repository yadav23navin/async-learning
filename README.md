# MiniTrack

MiniTrack is a task-management API built with Express.js to practice backend architecture, database access, Elasticsearch, pagination, and streaming.

## Architecture

The application separates responsibilities into layers:

- **Routes:** Define HTTP endpoints.
- **Controllers:** Handle HTTP requests and responses.
- **Services:** Contain business logic.
- **Repositories:** Handle data access.
- **Validation:** Validate incoming request data.
- **Error handling:** Return consistent API error responses.
- **Logging:** Record HTTP method, URL, status code, and request duration.

Request flow:

```text
Request
   ↓
Route
   ↓
Controller
   ↓
Service
   ↓
Repository
   ↓
Database / Elasticsearch
```

## Technologies

- Node.js
- Express.js
- PostgreSQL
- Elasticsearch
- JavaScript
- npm

## Elasticsearch Search

The `GET /search` endpoint supports full-text search, filters, aggregations, and cursor-based pagination.

Example:

```bash
curl -sS 'http://localhost:3000/search?q=login&size=5'
```

Supported filters include:

- `state`
- `assignee_id`
- `project_id`
- `priority`
- Created-date range
- Nested labels

Example with filters:

```bash
curl -sS 'http://localhost:3000/search?state=done&size=10'
```

The response includes matching results, a total-hit count, facet aggregations, and a `nextCursor` when another page is available.

Use the returned cursor for the next page, following the format supported by the endpoint.

## Dashboard

The `GET /dashboard` endpoint provides dashboard data through Elasticsearch aggregations.

Example:

```bash
curl -sS 'http://localhost:3000/dashboard'
```

## CSV Export

The `GET /export` endpoint streams matching work items as CSV. It uses Elasticsearch point-in-time (PIT) search and `search_after` pagination to process records in batches.

Export all work items:

```bash
curl -sS 'http://localhost:3000/export' -o work-items.csv
```

Export matching work items:

```bash
curl -sS 'http://localhost:3000/export?q=login' -o login-work-items.csv
```

The export supports the filters implemented by the search endpoint. CSV values are escaped, and response writes respect stream backpressure.

## Pagination and Performance

MiniTrack also includes learning exercises for offset pagination, cursor pagination, and Elasticsearch `search_after`.

The benchmark script is:

```bash
node scripts/benchmark-search-after.mjs
```

The benchmark compares search latency at different page depths. Results depend on the machine, dataset, and current system load.

## Data Loading

The `scripts/` directory contains scripts for loading work items and labels into Elasticsearch.

Check the script's options and required environment variables before running a data-loading script.

## Configuration

The application expects Elasticsearch connection settings through environment variables. Configure credentials locally and do not commit secrets.

Example:

```bash
ES_PASSWORD='your-local-password' npm run dev
```

Use your own local Elasticsearch password in place of the placeholder.

## Local Development

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

The API runs on port `3000` when configured with the project's current local settings.

## Learning Goals

- Layered backend architecture
- Database and Elasticsearch access
- Full-text search and filtering
- Aggregations and facet counts
- Cursor pagination and `search_after`
- Point-in-time searches
- Streaming CSV responses
- Backpressure and memory monitoring
- Performance benchmarking