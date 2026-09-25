# Async Benchmark

## Results

| Method | Time | Result Count |
|---|---:|---:|
| Sequential `for...of` | 5.020s | 50 |
| `Promise.all()` | 102.427ms | 50 |
| Concurrency pool (5) | 1.007s | 50 |
| `forEach(async ...)` | 0.623ms | 0 |

## Why the results are different

### 1. Sequential

`for...of` waits for each operation before starting the next one.

50 items × 100ms ≈ 5000ms.

### 2. Promise.all

All 50 operations are started without waiting for the previous one.

They run concurrently, so the total time is approximately the time of the slowest operation, around 100ms.

### 3. Concurrency pool

Only 5 operations are allowed to run at a time.

50 items / 5 = 10 batches.

10 × 100ms ≈ 1000ms.

### 4. forEach(async ...)

`forEach()` does not wait for the promises returned by its async callback.

The function returns before the async operations finish, so `results` is still empty and the measured time is almost zero.

## Conclusion

For a small number of operations, `Promise.all()` can provide high concurrency.

For a very large number such as 50,000 database operations, firing everything with `Promise.all()` at once can overload the database.

A concurrency pool is better when we need to limit the number of operations running at the same time.






# Error layer 

## Results

| Endpoint | Error Type | Status | errorCode |
|---|---|---:|---|
| `POST /validation` | Validation | 400 | `VALIDATION_ERROR` |
| `GET /unauthenticated` | Unauthenticated | 401 | `UNAUTHENTICATED` |
| `GET /forbidden` | Forbidden | 403 | `FORBIDDEN` |
| `GET /not-found` | Not Found | 404 | `NOT_FOUND` |
| `GET /conflict` | Conflict | 409 | `CONFLICT` |
| `GET /internal-error` | Unexpected Error | 500 | `INTERNAL_ERROR` |
| `GET /async-error` | Async Error | 500 | `INTERNAL_ERROR` |

What we built
# AppError

AppError is used for known application errors.

It allows us to provide:

Technical error message
HTTP status code
Stable error code
# catchAsync

Flow:

Async route
    ↓
Promise rejection
    ↓
catchAsync
    ↓
next(error)
    ↓
errorHandler

# displayMessages

The displayMessages map converts error codes into user-friendly messages.


# Central errorHandler

The central error handler separates developer information from user information.

console.error(error);

shows the technical error and stack in the server logs.

The API response contains the stable error code and user-friendly message.

Developer → Technical error + stack trace

User → errorCode + human-friendly message
Expected vs Unexpected Errors
Known errors

Known application errors use AppError.

AppError
    ↓
Known application problem
    ↓
Specific statusCode + errorCode

Examples:

Validation      → 400 VALIDATION_ERROR
Unauthenticated → 401 UNAUTHENTICATED
Forbidden       → 403 FORBIDDEN
Not Found       → 404 NOT_FOUND
Conflict        → 409 CONFLICT
Unexpected errors

Unexpected errors use normal JavaScript Error.

throw new Error("Database connection unexpectedly failed");

The error does not have our application-specific statusCode or errorCode.

The central error handler therefore falls back to:

500 INTERNAL_ERROR

with:

Something went wrong. Please try again later.
Development vs Production
Development

When the server is started normally:

node src/server.mjs

the response can include the stack:

{
    "success": false,
    "errorCode": "INTERNAL_ERROR",
    "message": "Something went wrong. Please try again later.",
    "stack": "Error: Database connection unexpectedly failed..."
}

This helps during development and debugging.

Production

When started with:

NODE_ENV=production node src/server.mjs

the stack is removed from the client response.

The user receives only:

{
    "success": false,
    "errorCode": "INTERNAL_ERROR",
    "message": "Something went wrong. Please try again later."
}

The developer still gets the full technical error and stack through:

console.error(error);





# day 3
# Input Validation & Security Shield — Learning Log

## Goal

Build and test an input-validation/security layer that prevents malformed,
unexpected, and potentially dangerous input from reaching the service layer.

---

## 1. Zod Validation

Created a reusable `validate(schema)` middleware.

It uses Zod's `safeParse()` to validate `req.body`.

Validation errors are converted into `AppError` with:

- HTTP status: `400`
- Error code: `VALIDATION_ERROR`
- Useful field-level messages

Example:

```json
{
  "name": 123
}

returns:

{
  "success": false,
  "errorCode": "VALIDATION_ERROR",
  "message": "name: Invalid input: expected string, received number"
}
2. Strict Object Validation

Used:

.strict()

on the Zod schema.

This rejects unexpected fields instead of silently ignoring them.

Example:

{
  "name": "Navin",
  "role": "admin"
}

is rejected with 400.

3. Input Rules Added

The validation schema checks:

name must be a non-empty string
HTML tags are rejected
null bytes are rejected
control characters are rejected
limit must be a positive integer
filter must contain only letters, numbers, and _
unexpected top-level fields are rejected
4. Request Body Size

Tested a 10 MB request body.

express.json() rejects oversized bodies before Zod runs.

Added handling for:

error.type === "entity.too.large"

so the API returns:

400 VALIDATION_ERROR

instead of an unexpected 500.

5. Duplicate JSON Keys

Discovered that JSON duplicate keys are normally handled by the
JSON parser before Zod receives the body.

Example:

{
  "name": "Navin",
  "name": "Admin"
}

becomes effectively:

{
  name: "Admin"
}

The first value is lost.

To detect duplicates, the original request body is captured using
the verify option of express.json():

app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));

A rejectDuplicateKeys middleware checks the raw body before
validation.

6. Attack Script

Created:

scripts/attack.sh

The script tests 10 malicious or malformed requests:

Extra unexpected key
Wrong data type
Script tag
10 MB request body
Negative limit
Missing body
SQL-like filter
Null byte
Control character
Duplicate JSON key

The script is executable using:

chmod +x scripts/attack.sh

and can be run using:

./scripts/attack.sh

All 10 attacks return HTTP 400.

## 7. Sanitization

Created:

src/sanitize.mjs

with an escapeHtml() function.

Example:

<script>alert(1)</script>

is converted to:

&lt;script&gt;alert(1)&lt;/script&gt;

A /tasks endpoint was added to demonstrate sanitization before
storage.

The stored result was confirmed as:

{
  "id": 1,
  "title": "&lt;script&gt;alert(1)&lt;/script&gt;"
}

This demonstrates that the HTML was escaped before being stored.

8. Important Security Concepts Learned
Validation

Checks whether input follows the expected rules.

"Is this input valid?"
Allowlist

Controls which fields the client is allowed to provide or modify.

"Is this field permitted?"
Sanitization

Transforms input into a safer representation for its intended use.

"How can this value be made safe?"

These are different responsibilities.

# Important GOTCHA — Allowlist + Schema

A new field needs to be added to both the validation schema and
the allowed-key list.

Example:

New field
   │
   ├── Zod schema
   │
   └── allowedTopLevelKeys

If the field is added only to Zod but not the allowlist, the security
shield may remove it before validation.

The request can then return:

200 OK

while the intended field update never reaches the service.

This creates a silent no-op.







## Day 4

# Day 4 — Layering, Dependency Injection, CRUD & Ship v0.1

## Goal

Refactor the MiniTrack Express application into clear layers and ship the first working version as `v0.1`.

The main goals were:

* Understand Route → Controller → Service → Repository architecture
* Understand dependency injection
* Build CRUD for Projects
* Build CRUD for Work Items
* Keep business logic out of routes/controllers
* Keep data access inside repositories
* Add validation and sanitization
* Add request logging
* Test the API with `curl`
* Initialize Git
* Commit and tag `v0.1`
* Push the project to a personal GitHub repository

---

# 1. Layered Architecture

The application was divided into four main layers.

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
Data
```

## Route

The route decides:

> Where should this HTTP request go?

Routes contain:

* HTTP method
* URL/path
* middleware
* validation
* controller connection

Routes should NOT contain:

* business logic
* database queries
* calculations
* external API calls

Example:

```js
router.post(
    "/",
    validate(createProjectSchema),
    projectController.create
);
```

---

## Controller

The controller handles HTTP-specific work.

It reads:

```text
req.params
req.body
```

and sends:

```text
res.status(...)
res.json(...)
```

It should not contain business rules or repository logic.

Example:

```js
const create = (req, res) => {
    const project = projectService.create(req.body.name);

    res.status(201).json({
        success: true,
        project
    });
};
```

---

## Service

The service contains business logic.

Mental model:

> What should happen?

The service should NOT know about:

* `req`
* `res`
* Express routes
* HTTP status codes
* raw database implementation

Example:

```js
const findById = (id) => {
    const project = projectRepository.findById(id);

    if (!project) {
        throw new AppError(
            "Project with the requested ID does not exist",
            404,
            "NOT_FOUND"
        );
    }

    return project;
};
```

---

## Repository

The repository handles data access.

Mental model:

> How do I access our data?

For v0.1, the repository uses an in-memory array.

Example:

```js
const projects = [];

const create = (project) => {
    projects.push(project);
    return project;
};

const findAll = () => {
    return projects;
};
```

Later, this repository can be changed to PostgreSQL, Redis, Elasticsearch, etc. without moving business logic into the service or route.

---

## Adaptor

An adaptor is used for communication with external systems.

Examples:

```text
Redis
Stripe
S3
Email provider
Elasticsearch
External APIs
```

Mental model:

> How do I talk to something outside our application?

The adaptor should not contain business decisions.

---

# 2. Dependency Injection

## What is a dependency?

A dependency is something a piece of code needs in order to work.

Example:

```js
class TaskService {
    constructor() {
        this.repository = new TaskRepository();
    }
}
```

The service creates its own dependency.

This creates tight coupling.

---

## Dependency Injection

Instead of creating the dependency internally, provide it from outside.

```js
const repository = new TaskRepository();

const service = new TaskService(repository);
```

Core idea:

> Don't make the class find or create what it needs. Give it what it needs.

Our project uses the same idea with factory functions.

Example:

```js
const projectService = createProjectService({
    projectRepository
});
```

The service receives the repository instead of importing and creating it internally.

---

# 3. Dependency Flow

At application startup:

```text
Server starts
    ↓
Create repositories
    ↓
Create services with repositories
    ↓
Create controllers with services
    ↓
Create routes with controllers
    ↓
Express app
```

For example:

```js
const projectRepository = createProjectRepository();

const projectService = createProjectService({
    projectRepository
});

const projectController = createProjectController({
    projectService
});

const projectRoutes = createProjectRoutes({
    projectController
});
```

This is the composition root of the application.

Dependencies are created once and reused for requests.

---

# 4. Project CRUD

Implemented:

```text
POST   /projects
GET    /projects
GET    /projects/:id
PATCH  /projects/:id
DELETE /projects/:id
```

Architecture:

```text
projectRoutes
      ↓
projectController
      ↓
projectService
      ↓
projectRepository
```

---

# 5. Create Project

## Curl

```bash
curl -X POST http://localhost:3000/projects \
  -H "Content-Type: application/json" \
  -d '{"name":"Website Redesign"}'
```

## Actual response

```json
{
  "success": true,
  "project": {
    "id": 1790004158900,
    "name": "Website Redesign"
  }
}
```

Project ID used for subsequent testing:

```text
1790004158900
```

---

# 6. Get All Projects

## Curl

```bash
curl http://localhost:3000/projects
```

## Result

The request was successfully verified.

The created project was returned in the projects collection.

---

# 7. Get Project By ID

## Curl

```bash
curl http://localhost:3000/projects/1790004158900
```

## Result

The request was successfully verified.

The project with ID `1790004158900` was returned.

---

# 8. Update Project

## Curl

```bash
curl -X PATCH http://localhost:3000/projects/1790004158900 \
  -H "Content-Type: application/json" \
  -d '{"name":"Updated Website Redesign"}'
```

## Actual response

```json
{
  "success": true,
  "project": {
    "id": 1790004158900,
    "name": "Updated Website Redesign"
  }
}
```

---

# 9. Delete Project

The DELETE endpoint was implemented:

```bash
curl -X DELETE http://localhost:3000/projects/1790004158900
```

The endpoint was intentionally not executed during the final README verification because the same project was needed for Work Item testing.

---

# 10. Work Item CRUD

Implemented:

```text
POST   /projects/:projectId/work-items
GET    /work-items
GET    /work-items/:id
PATCH  /work-items/:id
DELETE /work-items/:id
```

Architecture:

```text
workItemRoutes
      ↓
workItemController
      ↓
workItemService
      ↓
workItemRepository
```

The Work Item service also receives the Project repository because creating a work item requires checking whether the project exists.

```js
const createWorkItemService = ({
    workItemRepository,
    projectRepository
}) => {
```

This demonstrates dependency injection with multiple dependencies.

---

# 11. Create Work Item

## Curl

```bash
curl -X POST http://localhost:3000/projects/1790004158900/work-items \
  -H "Content-Type: application/json" \
  -d '{"title":"Implement login page"}'
```

The endpoint was tested successfully.

The project ID used was:

```text
1790004158900
```

---

# 12. Get All Work Items

## Curl

```bash
curl http://localhost:3000/work-items
```

The endpoint was tested successfully.

---

# 13. Get Work Item By ID

## Curl

```bash
curl http://localhost:3000/work-items/1
```

The endpoint was implemented and tested.

The ID should be replaced with the actual work item ID returned from creation.

---

# 14. Update Work Item

## Curl

```bash
curl -X PATCH http://localhost:3000/work-items/1 \
  -H "Content-Type: application/json" \
  -d '{"title":"Implement authentication"}'
```

The endpoint was implemented with validation and tested successfully.

---

# 15. Delete Work Item

## Curl

```bash
curl -X DELETE http://localhost:3000/work-items/1
```

The DELETE endpoint was implemented without the update validation middleware.

Important correction made during development:

Initially DELETE incorrectly used:

```js
validate(updateWorkItemSchema)
```

It was changed to:

```js
router.delete(
    "/work-items/:id",
    workItemController.remove
);
```

DELETE does not need the update body schema.

---

# 16. Task Vertical Slice

The existing Task implementation was also refactored into layers.

```text
taskRoutes
      ↓
taskController
      ↓
taskService
      ↓
taskRepository
```

Task endpoints:

```text
POST /tasks
GET  /tasks
```

## Create Task

```bash
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Review API documentation"}'
```

## Get Tasks

```bash
curl http://localhost:3000/tasks
```

The task vertical slice was successfully implemented and tested.

---

# 17. Validation

Zod validation remains part of the request flow.

Example:

```text
Request
   ↓
Route
   ↓
validate(schema)
   ↓
Controller
```

Invalid input is rejected before reaching the service.

Example:

```bash
curl -X POST http://localhost:3000/projects \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected status:

```text
400
```

Another example:

```bash
curl -X POST http://localhost:3000/projects/1790004158900/work-items \
  -H "Content-Type: application/json" \
  -d '{"title":123}'
```

Expected status:

```text
400
```

---

# 18. Sanitization

Project and Work Item names/titles are sanitized before storage.

Example:

```text
<script>alert(1)</script>
```

is converted to:

```text
&lt;script&gt;alert(1)&lt;/script&gt;
```

The service owns this business/data transformation rather than the route.

---

# 19. Request Logging

Created:

```text
src/logger.mjs
```

The logger records:

```text
HTTP method
URL
status code
request duration
```

Example output:

```text
GET /projects → 200 → 5ms
```

A 404 request was also tested and logged.

Example:

```text
GET /projects/999999999 → 404 → ...
```

The logger is registered globally:

```js
app.use(logger);
```

---

# 20. README

Created:

```text
README.md
```

The README contains:

* Project overview
* Architecture
* Project endpoints
* Work Item endpoints
* Task endpoints
* Validation examples
* Error examples
* Curl commands

The README is intended to provide runnable examples for the API.

---

# 21. npm Start Script

Initially:

```bash
npm start
```

failed with:

```text
npm error Missing script: "start"
```

Running:

```bash
npm run
```

showed that no npm scripts existed.

Added the following to `package.json`:

```json
{
  "scripts": {
    "start": "node src/server.mjs"
  },
  "dependencies": {
    "express": "^5.2.1",
    "zod": "^4.6.5"
  }
}
```

After the change:

```bash
npm start
```

returned:

```text
> start
> node src/server.mjs

Server running on port 3000
```

---

# 22. Debugging Issues During Layering

## Issue 1 — Work Item route factory did not return router

The route factory initially created the router but did not return it.

This caused:

```text
TypeError: argument handler must be a function
```

when mounting the route.

Fixed by adding:

```js
return router;
```

---

## Issue 2 — Wrong project route filename

There was a mismatch between:

```text
projectsRoutes.mjs
```

and the actual file:

```text
projectRoutes.mjs
```

The import was corrected.

---

## Issue 3 — Duplicate Work Item route declaration

The route factory was imported and instantiated incorrectly in `server.mjs`.

It was corrected to:

```js
import createWorkItemRoutes from "./routes/workItemRoutes.mjs";

const workItemRoutes = createWorkItemRoutes({
    workItemController
});
```

---

## Issue 4 — DELETE had update validation

Initially:

```js
router.delete(
    "/work-items/:id",
    validate(updateWorkItemSchema),
    workItemController.remove
);
```

This was incorrect because DELETE does not require an update body.

Changed to:

```js
router.delete(
    "/work-items/:id",
    workItemController.remove
);
```

---

## Issue 5 — Sanitization result was created but not stored

Initially the service created:

```js
const sanitizedTitle = escapeHtml(title);
```

but stored:

```js
title
```

instead of:

```js
title: sanitizedTitle
```

This meant the unsafe value was still stored.

Fixed to:

```js
const workItem = {
    id: Date.now(),
    title: sanitizedTitle
};
```

After the correction, sanitization worked correctly.

---

# 23. Git Setup

The project initially had no Git repository.

Initialized Git:

```bash
git init
```

Created the root `.gitignore`.

Contents:

```gitignore
node_modules/
.env
.env.*
```

Initially the `.gitignore` was accidentally created inside `src/`.

This was corrected by moving it to:

```text
~/Documents/async-learning/.gitignore
```

Verified:

```bash
git check-ignore -v node_modules/
```

Output:

```text
.gitignore:1:node_modules/      node_modules/
```

`git status` then confirmed `node_modules/` was no longer listed.

---

# 24. First Git Commit

Staged the project:

```bash
git add .
```

Verified the staged files using:

```bash
git status
```

Created the first commit:

```bash
git commit -m "Ship MiniTrack v0.1"
```

Actual commit:

```text
8c86b87 Ship MiniTrack v0.1
```

The commit contained:

```text
29 files changed
2363 insertions
```

---

# 25. v0.1 Tag

Created the release tag:

```bash
git tag v0.1
```

Verified:

```bash
git tag
```

Result:

```text
v0.1
```

---

# 26. Personal GitHub Repository

A personal GitHub repository was used instead of the company's Bitbucket repository because this is an independent learning project.

Remote:

```text
https://github.com/yadav23navin/async-learning.git
```

Added the remote:

```bash
git remote add origin https://github.com/yadav23navin/async-learning.git
```

Verified with:

```bash
git remote -v
```

---

# 27. Push to GitHub

Pushed the master branch:

```bash
git push -u origin master
```

Result:

```text
[new branch] master -> master
branch 'master' set up to track 'origin/master'
```

Pushed the release tag:

```bash
git push origin v0.1
```

Result:

```text
[new tag] v0.1 -> v0.1
```

---

# 28. Final Git Verification

Checked:

```bash
git status
```

The branch was confirmed to be up to date with:

```text
origin/master
```

and the working tree was clean.

---

# 29. Architecture Summary

Final application structure:

```text
src/
│
├── controllers/
│   ├── projectController.mjs
│   ├── taskController.mjs
│   └── workItemController.mjs
│
├── repositories/
│   ├── projectRepository.mjs
│   ├── taskRepository.mjs
│   └── workItemRepository.mjs
│
├── routes/
│   ├── projectRoutes.mjs
│   ├── taskRoutes.mjs
│   └── workItemRoutes.mjs
│
├── services/
│   ├── projectService.mjs
│   ├── taskService.mjs
│   └── workItemService.mjs
│
├── AppError.mjs
├── catchAsync.mjs
├── displayMessages.mjs
├── errorHandler.mjs
├── logger.mjs
├── projectSchemas.mjs
├── rejectDuplicateKeys.mjs
├── sanitize.mjs
├── server.mjs
├── validate.mjs
└── workItemSchemas.mjs
```

---

# 30. Request Lifecycle

A normal project request now follows:

```text
HTTP Request
     ↓
Route
     ↓
Validation middleware
     ↓
Controller
     ↓
Service
     ↓
Repository
     ↓
Data
     ↓
Repository
     ↓
Service
     ↓
Controller
     ↓
HTTP Response
```

For an error:

```text
Route / Controller / Service
          ↓
        Error
          ↓
    errorHandler
          ↓
HTTP error response
```

---

# 31. What We Learned

## Route

> Where does the request go?

## Controller

> How do I handle HTTP?

## Service

> What should happen?

## Repository

> How do I access our data?

## Adaptor

> How do I communicate with an external system?

## Dependency Injection

> Give a component what it needs instead of making it create/find the dependency itself.

---

# 32. Important Architecture Rule

A layer should not do another layer's job.

Bad:

```text
Route
 ├── SQL query
 ├── business rules
 ├── Redis call
 └── response
```

Better:

```text
Route
   ↓
Controller
   ↓
Service
   ↓
Repository / Adaptor
```

---

# 33. Why Layering Matters

The purpose of layering is not to create more files.

The purpose is to separate responsibilities.

For example, if the repository changes from:

```text
in-memory array
```

to:

```text
PostgreSQL
```

the service should not need to know how PostgreSQL works.

The same service can continue using:

```js
projectRepository.findById(id);
```

The implementation behind the repository can change.

---

# 34. Why Dependency Injection Matters

Without DI:

```text
Service
   ↓
creates repository itself
```

With DI:

```text
Composition root
      ↓
creates repository
      ↓
gives repository to service
```

This makes dependencies explicit and makes testing easier because a fake repository can be supplied.

---

# 35. v0.1 Definition of Done

* [x] No service directly creates a DB or Redis client.
* [x] Services receive their dependencies through parameters.
* [x] Route files contain no data-access queries.
* [x] Business logic is kept in services.
* [x] Data access is kept in repositories.
* [x] Projects CRUD implemented.
* [x] Work Items CRUD implemented.
* [x] Task vertical slice implemented.
* [x] Validation implemented.
* [x] Sanitization implemented.
* [x] Centralized error handling implemented.
* [x] Request logging implemented.
* [x] README created with endpoint examples.
* [x] Git repository initialized.
* [x] `.gitignore` configured.
* [x] First commit created.
* [x] `v0.1` tagged.
* [x] GitHub remote configured.
* [x] Code pushed to GitHub.
* [x] `v0.1` tag pushed.
* [x] Working tree clean.

The PR requirement was not completed because this is a new personal repository with a single `master` branch. A PR was not artificially created just for the sake of the checklist.

---

# 36. Final State

```text
MiniTrack v0.1
       │
       ├── Express
       ├── Zod
       ├── Validation
       ├── Sanitization
       ├── Error handling
       ├── Async error handling
       ├── Logging
       ├── CRUD
       ├── Layered architecture
       ├── Dependency injection
       ├── Git
       └── GitHub
```

Release:

```text
Commit: 8c86b87
Tag:    v0.1
```

Repository:

```text
https://github.com/yadav23navin/async-learning.git
```

**MiniTrack v0.1 — SHIPPED**





# Day 5 — PostgreSQL Data Modeling, Migrations, Constraints, Indexes and Seeding

## Goal

Design and migrate the MiniTrack database schema with:

- users
- projects
- project_members
- work_items
- labels
- work_item_labels
- comments
- activities

Also model:

- 1 organization
- real foreign keys
- real database constraints
- indexes on foreign-key columns
- realistic seed data
- 5,000 work items with varied status/priority/project distribution

---

# 1. PostgreSQL Setup

## Install PostgreSQL Node.js driver

Command:

```bash
npm install pg

Purpose:

pg is the Node.js PostgreSQL client library. It allows our JavaScript seed script to connect to PostgreSQL and execute SQL queries.

First PostgreSQL approach: Docker

Tried to start PostgreSQL using Docker:

docker run --name minitrack-postgres \
  -e POSTGRES_USER=minitrack \
  -e POSTGRES_PASSWORD=minitrack \
  -e POSTGRES_DB=minitrack \
  -p 5432:5432 \
  -d postgres:17

Result:

address already in use

Reason:

Port 5432 was already being used by a PostgreSQL server running directly on the machine.

Check what was using port 5432

Command:

sudo ss -ltnp | grep :5432

Output:

LISTEN 0 200 127.0.0.1:5432 0.0.0.0:* users:(("postgres",pid=1303,fd=6))

This confirmed that PostgreSQL was already running locally.

Remove failed Docker container

Command:

docker rm minitrack-postgres

The failed container was removed.

Instead of running another PostgreSQL instance, the existing local PostgreSQL installation was used.

Check PostgreSQL version

Command:

psql --version

Output:

psql (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
2. Create MiniTrack Database
Create database

Command:

sudo -u postgres createdb minitrack
Create database user

Command:

sudo -u postgres createuser --login --createdb minitrack
Make minitrack user the database owner

Command:

sudo -u postgres psql -c "ALTER DATABASE minitrack OWNER TO minitrack;"
Set database user password

Command:

sudo -u postgres psql -c "ALTER USER minitrack WITH PASSWORD 'minitrack';"

Local development credentials:

Database: minitrack
User: minitrack
Password: minitrack
Host: localhost
Port: 5432

These credentials are only for local development/learning.

Verify database connection

Command:

psql -U minitrack -d minitrack -h localhost

Connection succeeded:

psql (16.15 ...)
SSL connection (protocol: TLSv1.3, ...)
Type "help" for help.

minitrack=>
3. Initial Database Migration

Created:

migrations/001_initial_schema.sql

The migration created the following tables:

users
projects
project_members
work_items
labels
work_item_labels
comments
activities
users
CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

Important constraints:

id is the primary key
name cannot be NULL
email cannot be NULL
email must be unique
projects
CREATE TABLE projects (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

The CHECK constraint ensures project status can only be:

active
archived
project_members
CREATE TABLE project_members (
    project_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
        CHECK (role IN ('owner', 'member')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (project_id, user_id),

    FOREIGN KEY (project_id)
        REFERENCES projects(id)
        ON DELETE CASCADE,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

This represents the many-to-many relationship between users and projects.

One user can belong to many projects.

One project can contain many users.

The composite primary key:

(project_id, user_id)

prevents the same user from being added to the same project twice.

work_items
CREATE TABLE work_items (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL,
    assignee_id BIGINT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'todo'
        CHECK (status IN ('todo', 'in_progress', 'done')),
    priority TEXT NOT NULL DEFAULT 'medium'
        CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    FOREIGN KEY (project_id)
        REFERENCES projects(id)
        ON DELETE CASCADE,

    FOREIGN KEY (assignee_id)
        REFERENCES users(id)
        ON DELETE SET NULL
);

Important relationship:

project_id → projects.id

Every work item must belong to a project.

assignee_id is nullable because a task can be unassigned.

If an assigned user is deleted:

ON DELETE SET NULL

keeps the task but removes the assignment.

labels
CREATE TABLE labels (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
work_item_labels
CREATE TABLE work_item_labels (
    work_item_id BIGINT NOT NULL,
    label_id BIGINT NOT NULL,

    PRIMARY KEY (work_item_id, label_id),

    FOREIGN KEY (work_item_id)
        REFERENCES work_items(id)
        ON DELETE CASCADE,

    FOREIGN KEY (label_id)
        REFERENCES labels(id)
        ON DELETE CASCADE
);

This creates a many-to-many relationship:

work_items ↔ labels
comments
CREATE TABLE comments (
    id BIGSERIAL PRIMARY KEY,
    work_item_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    FOREIGN KEY (work_item_id)
        REFERENCES work_items(id)
        ON DELETE CASCADE,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE RESTRICT
);

A comment belongs to:

one work item
one user

ON DELETE RESTRICT prevents deleting a user who still owns comments.

activities
CREATE TABLE activities (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL,
    work_item_id BIGINT,
    user_id BIGINT,
    action TEXT NOT NULL
        CHECK (action IN (
            'created',
            'updated',
            'status_changed',
            'assigned',
            'commented',
            'label_added'
        )),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    FOREIGN KEY (project_id)
        REFERENCES projects(id)
        ON DELETE CASCADE,

    FOREIGN KEY (work_item_id)
        REFERENCES work_items(id)
        ON DELETE CASCADE,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE SET NULL
);

metadata uses PostgreSQL JSONB so different activity types can store additional information.

Example:

{
  "old_status": "todo",
  "new_status": "in_progress"
}
4. Foreign-Key Indexes

Added indexes:

CREATE INDEX idx_project_members_user_id
    ON project_members(user_id);

CREATE INDEX idx_work_items_project_id
    ON work_items(project_id);

CREATE INDEX idx_work_items_assignee_id
    ON work_items(assignee_id);

CREATE INDEX idx_work_item_labels_label_id
    ON work_item_labels(label_id);

CREATE INDEX idx_comments_work_item_id
    ON comments(work_item_id);

CREATE INDEX idx_comments_user_id
    ON comments(user_id);

CREATE INDEX idx_activities_project_id
    ON activities(project_id);

CREATE INDEX idx_activities_work_item_id
    ON activities(work_item_id);

CREATE INDEX idx_activities_user_id
    ON activities(user_id);

Reason:

Foreign keys do not automatically mean that the referencing column has a useful index.

Indexes help queries such as:

SELECT *
FROM work_items
WHERE project_id = 10;

and joins such as:

SELECT *
FROM work_items
JOIN projects
ON work_items.project_id = projects.id;

Some indexes were not needed separately because the composite primary keys already provide them.

For example:

project_members(project_id, user_id)

already indexes project_id.

Therefore we added a separate index for:

project_members.user_id

Similarly:

work_item_labels(work_item_id, label_id)

already indexes work_item_id, so a separate index was added for:

work_item_labels.label_id
5. Apply Initial Migration

Command:

psql -U minitrack -d minitrack -h localhost -f migrations/001_initial_schema.sql

Result:

CREATE TABLE
CREATE TABLE
CREATE TABLE
CREATE TABLE
CREATE TABLE
CREATE TABLE
CREATE TABLE
CREATE TABLE
CREATE INDEX
CREATE INDEX
CREATE INDEX
CREATE INDEX
CREATE INDEX
CREATE INDEX
CREATE INDEX
CREATE INDEX
CREATE INDEX
6. Verify Tables

Command:

psql -U minitrack -d minitrack -h localhost -c "\dt"

The 8 tables were present:

activities
comments
labels
project_members
projects
users
work_item_labels
work_items
7. Add Organization Model

The original requirement included:

1 organization

but the initial table list did not include an organization table.

Instead of putting organization data somewhere incorrectly, a separate organization entity was added.

Created:

migrations/002_add_organizations.sql

Contents:

CREATE TABLE organizations (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE projects
ADD COLUMN organization_id BIGINT NOT NULL
    REFERENCES organizations(id)
    ON DELETE CASCADE;

CREATE INDEX idx_projects_organization_id
    ON projects(organization_id);

Final relationship:

organizations
      |
      | 1 : many
      ↓
   projects
      |
      | 1 : many
      ↓
 work_items
8. Apply Organization Migration

Command:

psql -U minitrack -d minitrack -h localhost -f migrations/002_add_organizations.sql

Result:

CREATE TABLE
ALTER TABLE
CREATE INDEX

Final database contains 9 tables:

organizations
users
projects
project_members
work_items
labels
work_item_labels
comments
activities
9. Seed Script

Created:

scripts/seed.mjs

The seed script uses:

import pg from "pg";

and connects to PostgreSQL using the pg Node.js driver.

The seed script:

Connects to PostgreSQL
Starts a transaction
Clears existing seed data
Creates one organization
Creates 20 users
Creates 3 projects
Creates project memberships
Creates 12 labels
Creates 5,000 work items
Adds 1–3 labels to work items
Creates comments
Creates activities
Commits the transaction
Rolls back if an error occurs

The seed data is randomized so the 5,000 work items are not identical.

10. Run Seed Script

Command:

node scripts/seed.mjs

Output:

Clearing existing seed data...
Creating organization...
Creating 20 users...
Creating 3 projects...
Creating project memberships...
Creating labels...
Creating 5,000 work items...
Created 500 work items...
Created 1000 work items...
Created 1500 work items...
Created 2000 work items...
Created 2500 work items...
Created 3000 work items...
Created 3500 work items...
Created 4000 work items...
Created 4500 work items...
Created 5000 work items...
Adding labels to work items...
Creating comments...
Creating activities...

Seed completed successfully.
Organization: 1
Users: 20
Projects: 3
Work items: 5000
Labels: 12
11. Verify Seed Counts

Command:

psql -U minitrack -d minitrack -h localhost -c "SELECT (SELECT COUNT(*) FROM organizations) AS organizations, (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM projects) AS projects, (SELECT COUNT(*) FROM project_members) AS project_members, (SELECT COUNT(*) FROM work_items) AS work_items, (SELECT COUNT(*) FROM labels) AS labels, (SELECT COUNT(*) FROM work_item_labels) AS work_item_labels, (SELECT COUNT(*) FROM comments) AS comments, (SELECT COUNT(*) FROM activities) AS activities;"

Output:

organizations | users | projects | project_members | work_items | labels | work_item_labels | comments | activities
--------------+-------+----------+-----------------+------------+--------+------------------+----------+-----------
1             | 20    | 3        | 30              | 5000       | 12     | 9986             | 3444     | 12513

Verified:

Organizations:   1
Users:           20
Projects:         3
Members:         30
Work items:    5000
Labels:          12
Item labels:   9986
Comments:      3444
Activities:   12513
12. Verify Realistic Work-Item Distribution

Command:

psql -U minitrack -d minitrack -h localhost -c "SELECT p.name AS project, w.status, w.priority, COUNT(*) AS task_count FROM work_items w JOIN projects p ON p.id = w.project_id GROUP BY p.name, w.status, w.priority ORDER BY p.name, w.status, w.priority;"

Example output included:

MiniTrack | done        | high   | 42
MiniTrack | done        | low    | 63
MiniTrack | done        | medium | 137
MiniTrack | done        | urgent | 17

MiniTrack | in_progress | high   | 88
MiniTrack | in_progress | low    | 114
MiniTrack | in_progress | medium | 263
MiniTrack | in_progress | urgent | 32

MiniTrack | todo        | high   | 180
MiniTrack | todo        | low    | 235
MiniTrack | todo        | medium | 455
MiniTrack | todo        | urgent | 69

This verified that tasks were distributed across:

Projects
Statuses
Priorities

rather than all 5,000 tasks being identical.

13. Verify Project Distribution

Command:

psql -U minitrack -d minitrack -h localhost -c "SELECT p.name AS project, COUNT(*) AS task_count FROM work_items w JOIN projects p ON p.id = w.project_id GROUP BY p.name ORDER BY p.name;"

Verified approximately:

MiniTrack       | 1695
MusicVerse      | 1635
String Projects | 1670

Total:

1695 + 1635 + 1670 = 5000

Therefore all 5,000 work items belong to the three projects with a realistic distribution.

14. Verify Primary Keys, Unique Constraints and Foreign Keys

Command:

psql -U minitrack -d minitrack -h localhost -c "SELECT conrelid::regclass AS table_name, conname AS constraint_name, contype AS type FROM pg_constraint WHERE contype IN ('f','u','p') ORDER BY conrelid::regclass::text, conname;"

Constraint types:

p = primary key
u = unique constraint
f = foreign key

Verified foreign keys including:

projects              projects_organization_id_fkey
work_item_labels      work_item_labels_label_id_fkey
work_item_labels      work_item_labels_work_item_id_fkey
work_items            work_items_assignee_id_fkey
work_items            work_items_project_id_fkey

This confirmed that the relationships are enforced by PostgreSQL itself.

15. Test Foreign-Key Enforcement

Tested an invalid project ID intentionally.

Command:

psql -U minitrack -d minitrack -h localhost -c "BEGIN; INSERT INTO work_items (project_id, title) VALUES (999999, 'FK test'); ROLLBACK;"

Output:

BEGIN

ERROR: insert or update on table "work_items" violates foreign key constraint "work_items_project_id_fkey"

DETAIL:
Key (project_id)=(999999) is not present in table "projects".

This proves that PostgreSQL rejected a work item referencing a project that does not exist.

The transaction was rolled back so no test data remained.

16. Verify Indexes

Command:

psql -U minitrack -d minitrack -h localhost -c "SELECT tablename, indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname;"

Verified indexes including:

activities
    activities_pkey
    idx_activities_project_id
    idx_activities_user_id
    idx_activities_work_item_id

comments
    comments_pkey
    idx_comments_user_id
    idx_comments_work_item_id

labels
    labels_pkey
    labels_name_key

organizations
    organizations_pkey
    organizations_name_key

project_members
    project_members_pkey
    idx_project_members_user_id

projects
    idx_projects_organization_id
    projects_pkey

users
    users_email_key
    users_pkey

work_item_labels
    idx_work_item_labels_label_id
    work_item_labels_pkey

work_items
    idx_work_items_assignee_id
    idx_work_items_project_id
    work_items_pkey

This confirmed that the intended foreign-key indexes exist.




## Day 6 — Indexes & Query Plan

### Seed

Increased the seed from 5,000 to 500,000 work items.

The seed completed successfully with:

- Organizations: 1
- Users: 20
- Projects: 3
- Work items: 500,000
- Labels: 12

### List query

Tested this query:

```sql
SELECT id, project_id, title, status, created_at
FROM work_items
WHERE project_id = 1
  AND status = 'todo'
ORDER BY created_at DESC
LIMIT 50;

Query plan experiments
1. No index

Removed:

idx_work_items_project_id

Plan:

Parallel Seq Scan

Execution time:

115.993 ms

PostgreSQL scanned the table, filtered by project_id and status, then sorted the matching rows.

2. Wrong composite index

Created:

CREATE INDEX idx_work_items_created_project
ON work_items(created_at DESC, project_id);

Plan:

Index Scan using idx_work_items_created_project

Execution time:

0.209 ms

The index could still be used because PostgreSQL could locate project_id = 1 and read rows in created_at DESC order.

3. Right composite index

Removed the wrong index and created:

CREATE INDEX idx_work_items_project_created_at
ON work_items(project_id, created_at DESC);

Plan:

Index Scan using idx_work_items_project_created_at

Execution time:

0.211 ms

This column order directly matches the query pattern:

project_id → created_at DESC
Comparison
Test	Plan	Execution Time
No index	Parallel Seq Scan	115.993 ms
(created_at DESC, project_id)	Index Scan	0.209 ms
(project_id, created_at DESC)	Index Scan	0.211 ms

Observation

The no-index query required a sequential scan across the large table.

Both composite indexes were able to produce a very fast index scan for this particular query and dataset. The right index follows the natural leftmost-prefix pattern for WHERE project_id = ? ORDER BY created_at DESC.

The measured timings can vary between runs because of PostgreSQL cache state and system load


### N+1 Query Experiment

Created `scripts/n-plus-one.mjs` to demonstrate the N+1 query problem.

#### N+1 version

The application first fetched 50 work items, then executed one label query for each work item.

```text
1 query → fetch 50 work items
50 queries → fetch labels
Total: 51 database queries

Timing:

27.080 ms
Batched version

Replaced the loop with one query using:

WHERE wil.work_item_id = ANY($1::bigint[])

Now the application performs:

1 query → fetch 50 work items
1 query → fetch labels for all 50 items
Total: 2 database queries

Timing:

8.779 ms

N+1 version

1 query → fetch 50 work items
50 queries → fetch labels for each work item
Total: 51 queries

Batched version

1 query → fetch 50 work items
1 query → fetch labels for all 50 items using IN (...)
Total: 2 queries

The query count dropped from 51 to 2 because the per-item label queries were replaced with one batched query.





# Day 7 — BUILD / SHIP
## Transactions, races & concurrent writes

### Goal

Write `scripts/race.mjs` to reproduce a lost update using two concurrent writers, then fix the race using optimistic locking with a `version` column and compare-and-set.

---

## 1. Created the race script

File:

```text
scripts/race.mjs

The script creates two PostgreSQL clients:

const clientA = createClient();
const clientB = createClient();

await clientA.connect();
await clientB.connect();

Both clients target the same work item:

const workItemId = 1;
2. Reproduced the lost update

Both writers first read the same row:

const resultA = await clientA.query(
    `SELECT id, title FROM work_items WHERE id = $1`,
    [workItemId]
);

const resultB = await clientB.query(
    `SELECT id, title FROM work_items WHERE id = $1`,
    [workItemId]
);

Then both updates were fired concurrently:

const updateA = clientA.query(
    `UPDATE work_items
     SET title = $1
     WHERE id = $2`,
    ["Writer A edit", workItemId]
);

const updateB = clientB.query(
    `UPDATE work_items
     SET title = $1
     WHERE id = $2`,
    ["Writer B edit", workItemId]
);

await Promise.all([updateA, updateB]);
Command
node scripts/race.mjs
Output
Writer A read: Add tests for notifications
Writer B read: Add tests for notifications

Final row:
{ id: '1', title: 'Writer A edit' }

Writer A edit: Writer A edit
Writer B edit: Writer B edit
One edit was overwritten by the other.
Result

The lost update was successfully reproduced.

Both writers read the same original value, but one writer's update overwrote the other writer's update.

3. Added the version column

Connected to PostgreSQL using:

psql -h localhost -U minitrack -d minitrack

Added the column:

ALTER TABLE work_items
ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

Verified it:

SELECT id, title, version
FROM work_items
WHERE id = 1;

Output:

1 | Writer A edit | 1

Also verified the schema using:

\d work_items

The work_items table now contains:

version | integer | not null | default 1
4. Added migration file

Created:

migrations/004_add_work_item_version.sql

Contents:

ALTER TABLE work_items
ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

The database column had already been added manually during the experiment, so the migration file records the schema change for the project.

5. Added compare-and-set

The update was changed from:

UPDATE work_items
SET title = $1
WHERE id = $2;

to:

UPDATE work_items
SET title = $1,
    version = version + 1
WHERE id = $2
  AND version = $3
RETURNING id, title, version;

The important part is:

AND version = $3

The writer can only update the row if the version it originally read is still current.

6. Updated race.mjs

Both writers now read:

SELECT id, title, version
FROM work_items
WHERE id = $1;

Writer A:

const updateA = clientA.query(
    `UPDATE work_items
     SET title = $1,
         version = version + 1
     WHERE id = $2
       AND version = $3
     RETURNING id, title, version`,
    ["Writer A edit", workItemId, resultA.rows[0].version]
);

Writer B:

const updateB = clientB.query(
    `UPDATE work_items
     SET title = $1,
         version = version + 1
     WHERE id = $2
       AND version = $3
     RETURNING id, title, version`,
    ["Writer B edit", workItemId, resultB.rows[0].version]
);

Both still execute concurrently:

const [resultUpdateA, resultUpdateB] = await Promise.all([
    updateA,
    updateB
]);
7. Added 409 Conflict handling

If an update affects zero rows:

if (resultUpdateB.rowCount === 0) {
    console.log("Writer B → 409 Conflict");
    console.log(
        "Message: This item was changed by someone else. Please refresh and try again."
    );
}

The same handling exists for Writer A because either writer can lose depending on timing.

In the real API, this would be an actual HTTP 409 Conflict. The script prints the expected application behavior.

8. Re-ran the race
Command
node scripts/race.mjs
Output
Writer A read: Writer B edit
Writer B read: Writer B edit
Writer B → 409 Conflict
Message: This item was changed by someone else. Please refresh and try again.

Final row:
{ id: '1', title: 'Writer A edit', version: 3 }
Result

The race is now protected.

Writer A successfully updated the row and incremented the version.

Writer B still had the old version, so:

AND version = $3

failed to match the row.

Therefore Writer B updated zero rows and received a 409 Conflict instead of silently overwriting Writer A's change.

9. Verified transaction/network-call requirement

Ran:

grep -RniE "BEGIN|COMMIT|ROLLBACK|fetch\(|axios|https?://" . --exclude-dir=node_modules --exclude-dir=.git

Relevant transaction output:

./scripts/seed.mjs:142:        await client.query("BEGIN");
./scripts/seed.mjs:428:        await client.query("COMMIT");
./scripts/seed.mjs:438:        await client.query("ROLLBACK");

No fetch() or axios call was found in the project source.

The transaction in scripts/seed.mjs is database-only and does not span a network call to another service.

10. Final BUILD / SHIP result
Before
Two writers
    ↓
Both read same data
    ↓
Both update
    ↓
One silently overwrites the other
    ↓
Lost update
After
Two writers
    ↓
Both read same version
    ↓
First writer updates + increments version
    ↓
Second writer uses old version
    ↓
UPDATE matches 0 rows
    ↓
409 Conflict
    ↓
No silent overwrite
Files added/changed
scripts/race.mjs
migrations/004_add_work_item_version.sql


BUILD / SHIP completed
☑ Reproduced lost update.
☑ Added version column.
☑ Added compare-and-set update.
☑ Added 409 conflict handling.
☑ Re-ran concurrent update test.
☑ Proved the second writer is rejected.
☑ Verified no transaction spans a network call.
