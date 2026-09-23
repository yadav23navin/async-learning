# MiniTrack

MiniTrack is a small Express.js task management API built to practice clean backend architecture.

The project separates responsibilities into layers:

- **Routes** — define HTTP endpoints and middleware.
- **Controllers** — handle HTTP request/response logic.
- **Services** — contain business logic.
- **Repositories** — handle data access.
- **Validation** — validates incoming request data.
- **Error handling** — provides consistent API error responses.
- **Logging** — records HTTP method, URL, status code, and request duration.

## Architecture

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
In-memory data




## Project Endpoints

### Create a project

```bash
curl -X POST http://localhost:3000/projects \
  -H "Content-Type: application/json" \
  -d '{"name":"Website Redesign"}'


  Get all projects
curl http://localhost:3000/projects
Get a project by ID

Replace 1 with an actual project ID returned from the create request.

curl http://localhost:3000/projects/1
Update a project

Replace 1 with an actual project ID.

curl -X PATCH http://localhost:3000/projects/1 \
  -H "Content-Type: application/json" \
  -d '{"name":"Updated Website Redesign"}'
Delete a project

Replace 1 with an actual project ID.

curl -X DELETE http://localhost:3000/projects/1




## Work Item Endpoints

### Create a work item

Replace `1` with an actual project ID.

```bash
curl -X POST http://localhost:3000/projects/1/work-items \
  -H "Content-Type: application/json" \
  -d '{"title":"Implement login page"}'



  Get all work items
curl http://localhost:3000/work-items
Get a work item by ID

Replace 1 with an actual work item ID.

curl http://localhost:3000/work-items/1
Update a work item

Replace 1 with an actual work item ID.

curl -X PATCH http://localhost:3000/work-items/1 \
  -H "Content-Type: application/json" \
  -d '{"title":"Implement authentication"}'
Delete a work item

Replace 1 with an actual work item ID.

curl -X DELETE http://localhost:3000/work-items/1


## Task Endpoints

### Create a task

```bash
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Review API documentation"}'

  Get all tasks
curl http://localhost:3000/tasks

## Validation and Error Handling

### Invalid project request

The project name is required.

```bash
curl -X POST http://localhost:3000/projects \
  -H "Content-Type: application/json" \
  -d '{}'

  Expected response:

{
  "success": false,
  "status": 400
}
Project not found
curl http://localhost:3000/projects/999999999

Expected response:

{
  "success": false,
  "status": 404
}
Invalid work item request
curl -X POST http://localhost:3000/projects/1/work-items \
  -H "Content-Type: application/json" \
  -d '{"title":123}'

Expected response:

{
  "success": false,
  "status": 400
}

The API uses centralized error handling so that errors from services and middleware are converted into consistent HTTP responses.



# day 5
## Database Schema

```text
┌──────────────────┐
│  organizations   │
├──────────────────┤
│ id PK            │
│ name UNIQUE      │
│ created_at       │
└────────┬─────────┘
         │ 1:N
         ▼
┌──────────────────┐
│     projects     │
├──────────────────┤
│ id PK            │
│ organization_id FK
│ name             │
│ description      │
│ status           │
│ created_at       │
└──────┬───────────┘
       │
       ├─────────────── 1:N ──────────────┐
       ▼                                  ▼
┌──────────────────┐              ┌──────────────────┐
│   work_items     │              │ project_members  │
├──────────────────┤              ├──────────────────┤
│ id PK            │              │ project_id FK    │
│ project_id FK    │              │ user_id FK       │
│ assignee_id FK   │              │ role             │
│ title            │              │ joined_at        │
│ description      │              │ PK(project_id,   │
│ status           │              │    user_id)      │
│ priority         │              └────────┬─────────┘
│ created_at       │                       │
│ updated_at       │                       │
└──────┬───────────┘                       │
       │                                   │
       │                                   │
       ├─────────────── 1:N ────────┐      │
       ▼                            ▼      │
┌──────────────────┐        ┌──────────────────┐
│    comments      │        │ work_item_labels │
├──────────────────┤        ├──────────────────┤
│ id PK            │        │ work_item_id FK  │
│ work_item_id FK  │        │ label_id FK      │
│ user_id FK       │        │ PK(work_item_id, │
│ body             │        │    label_id)     │
│ created_at       │        └────────┬─────────┘
│ updated_at       │                 │
└──────────────────┘                 │ N:1
                                     ▼
                              ┌──────────────────┐
                              │      labels      │
                              ├──────────────────┤
                              │ id PK            │
                              │ name UNIQUE      │
                              │ created_at       │
                              └──────────────────┘


┌──────────────────┐
│      users       │
├──────────────────┤
│ id PK            │
│ name             │
│ email UNIQUE     │
│ created_at       │
└──────────────────┘
       ▲
       │
       ├──── project_members.user_id
       ├──── work_items.assignee_id
       └──── comments.user_id


┌──────────────────┐
│    activities    │
├──────────────────┤
│ id PK            │
│ project_id FK    │
│ work_item_id FK  │
│ user_id FK       │
│ action           │
│ metadata JSONB   │
│ created_at       │
└──────────────────┘

Relationship Summary
Organization → Projects = 1:N
Projects → Work Items = 1:N
Users ↔ Projects = N:M through project_members
Work Items ↔ Labels = N:M through work_item_labels
Work Items → Comments = 1:N
Projects → Activities = 1:N
Work Items → Activities = 1:N
Users → Comments = 1:N
Users → Activities = 1:N
Users → Work Items = 1:N through assignee_id