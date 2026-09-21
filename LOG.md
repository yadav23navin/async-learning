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


