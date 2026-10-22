# MiniTrack

MiniTrack is a task-management API built with Express.js to practice backend architecture, database access, Elasticsearch, pagination, streaming, caching, and asynchronous messaging.

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

Request
   ↓
Route
   ↓
Validation Middleware
   ↓
Controller
   ↓
Service
   ↓
Repository
   ↓
Database / Elasticsearch

For asynchronous email notifications, the service publishes domain events to RabbitMQ. A separate worker consumes these events and sends emails through MailHog.

## Technologies

- Node.js
- Express.js
- PostgreSQL
- Elasticsearch
- Redis
- RabbitMQ
- MailHog
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

MiniTrack includes learning exercises for offset pagination, cursor pagination, and Elasticsearch `search_after`.

The benchmark script is:

```bash
node scripts/benchmark-search-after.mjs
```

The benchmark compares search latency at different page depths. Results depend on the machine, dataset, and current system load.

## Data Loading

The `scripts/` directory contains scripts for loading work items and labels into Elasticsearch.

Check each script's options and required environment variables before running a data-loading script.

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

## Day 19 — RabbitMQ Event-Driven Email Notifications

### Objective

Implement asynchronous email notifications using RabbitMQ so that email delivery happens outside the API request's synchronous path.

### Architecture

```text
Client
   |
   v
Express API
   |
   +----> PostgreSQL
   |      Create / update work item
   |
   +----> Redis
   |      Cache invalidation
   |
   +----> RabbitMQ Publisher
              |
              v
       work_items.events
          (Topic Exchange)
              |
              +---- work_item.created
              |          |
              |          v
              |   work_item_created.email
              |
              +---- work_item.assigned
                         |
                         v
                 work_item_assigned.email
                         |
                         v
                    Email Worker
                         |
                         v
                    MailHog SMTP
                         |
                         v
                    MailHog Inbox
```

### Events

**1. `work_item.created`**

Published when a new work item is created. The event contains:

- Work-item ID
- Project ID
- Title

**2. `work_item.assigned`**

Published when a work item's `assignee_id` is updated. The event contains:

- Work-item ID
- Project ID
- Title
- Assignee ID

Each event includes a unique event ID, event type, timestamp, and event data.

### RabbitMQ Topology

| Component | Name | Purpose |
|---|---|---|
| Topic exchange | `work_items.events` | Routes work-item events |
| Queue | `work_item_created.email` | Receives creation events |
| Queue | `work_item_assigned.email` | Receives assignment events |
| Direct exchange | `work_items.dead` | Routes rejected messages |
| Dead-letter queue | `work_item_created.email.failed` | Stores failed creation notifications |
| Dead-letter queue | `work_item_assigned.email.failed` | Stores failed assignment notifications |

The publisher and worker declare durable exchanges and queues. Event messages are published as persistent messages.

### Reliability and Acknowledgements

- **Publisher confirmations:** The API waits for RabbitMQ to confirm publication.
- **Manual acknowledgements:** The worker acknowledges a message only after `sendMail` succeeds.
- **Prefetch:** `prefetch(1)` limits the worker to one unacknowledged message at a time.
- **Dead-letter queues:** Failed messages are rejected without requeue and routed to durable failed-message queues.
- **Separate worker:** Email delivery is handled independently of the API request.

Transient failures retry with 2-second and 4-second backoffs, for up to three total attempts. Permanent failures go directly to the DLQ. Redis-backed idempotency keys suppress duplicate processing, and processing locks reduce concurrent duplicate work.

### Local Setup

Start RabbitMQ and MailHog:

```bash
docker compose up -d
```

Start the API in one terminal:

```bash
npm run dev
```

Start the email worker in another terminal:

```bash
npm run worker:email
```

The worker should display:

```text
Email worker connected. Waiting for messages...
```

Keep both the API and worker running during testing.

### Local Services

| Service | URL |
|---|---|
| API | http://localhost:3000 |
| RabbitMQ Management UI | http://localhost:15672 |
| MailHog Inbox | http://localhost:8025 |
| MailHog SMTP | `localhost:1025` |

RabbitMQ's default local development credentials are `guest` / `guest`.

MailHog captures test emails so they can be inspected in the inbox instead of being delivered to real recipients.

### Environment Variables

The notification implementation supports the following variables:

- `RABBITMQ_URL` — RabbitMQ connection URL; defaults to `amqp://localhost:5672`.
- `SMTP_HOST` — SMTP host; defaults to `localhost`.
- `SMTP_PORT` — SMTP port; defaults to `1025`.
- `NOTIFICATION_EMAIL_FROM` — sender email address.
- `NOTIFICATION_EMAIL_TO` — test recipient email address.

For assignment events, the worker looks up the assignee and checks their notification preference in Redis, falling back to the database when needed. Emails are sent through the configured SMTP service when notifications are enabled.

### End-to-End Testing

#### 1. Test work-item creation

```bash
curl -i -X POST http://localhost:3000/projects/1/work-items \
  -H 'Content-Type: application/json' \
  -d '{"title":"Day 19 RabbitMQ email test"}'
```

Expected result: the API returns `201 Created`.

The worker should log a message similar to:

```text
Email sent for work_item.created; event ID: <event-id>
```

#### 2. Test work-item assignment

Assign an existing work item to a valid user ID:

```bash
curl -i -X PATCH http://localhost:3000/work-items/500339 \
  -H 'Content-Type: application/json' \
  -d '{"assignee_id":1}'
```

Expected result: the API successfully updates the assignment, and the worker logs a message similar to:

```text
Email sent for work_item.assigned; event ID: <event-id>
```

#### 3. Verify email delivery

Open the MailHog inbox:

http://localhost:8025

Verify that the creation and assignment notification emails are present.

### Verified Results

During local testing:

- Created a work item in project `1`; the API returned `201 Created`.
- The worker successfully processed `work_item.created`.
- Assigned work item `500339` to user `1`.
- The worker successfully processed `work_item.assigned`.
- Both event types produced successful email-send logs.

### Important Design Considerations

**API latency**

The API waits for the database operation, cache invalidation, and RabbitMQ publisher confirmation. It does not wait for the email worker to finish sending the email.

**Database and broker consistency**

A database write and RabbitMQ publication are not one atomic transaction. If the database write succeeds but event publication fails, the event may be lost. A transactional outbox is a stronger production design for addressing this consistency problem.

**Duplicate delivery**

Messages can be delivered or processed more than once under certain failure conditions. Production email handling should consider idempotency or deduplication to prevent duplicate notifications.

**Failure monitoring**

Dead-letter queues preserve rejected messages for investigation. Production systems should monitor these queues and define an operational process for diagnosing and replaying failed events safely.

## Observability and Load Testing

`GET /metrics` reports queue depths, processed-event count, and failure count.

Run `node scripts/load-rabbitmq-10k.mjs` to publish 10,000 persistent test messages to the dedicated `day21.loadtest` queue. This does not send notification emails. Use an empty queue and run the script once for a reliable peak-depth measurement.

Latest local run: 10,000 events in 0.53 seconds, approximately 18,793 events/second, peak queue depth 10,000, and 0 publish failures. Results depend on local conditions.

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
- RabbitMQ exchanges, queues, and routing keys
- Asynchronous event-driven architecture
- Manual acknowledgements and prefetch
- Dead-letter queues and failure handling
- Email testing with MailHog
- Transactional outbox and idempotency concepts
