const baseUrl = process.env.API_URL || "http://localhost:3000";
const unique = `day17-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};
const request = async (path, options) => {
    const response = await fetch(new URL(path, baseUrl), options);
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { response, body };
};

let createdId;
let temporaryProjectId;
let result = "API validation failed";
try {
    const projectResponse = await request("/projects", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: unique })
    });
    assert(projectResponse.response.status === 201 && projectResponse.body.project?.id, "Temporary project create failed");
    temporaryProjectId = projectResponse.body.project.id;
    const projectRead = await request(`/projects/${temporaryProjectId}`);
    assert(projectRead.response.ok && String(projectRead.body.project.id) === String(temporaryProjectId), "Project lookup did not return the PostgreSQL row");
    const projectUpdate = await request(`/projects/${temporaryProjectId}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: `${unique}-renamed` })
    });
    assert(projectUpdate.response.ok && projectUpdate.body.project.name === `${unique}-renamed`, "Project update failed");

    const pagePath = `/work-items?page=1&limit=50&day17=${encodeURIComponent(unique)}`;
    const first = await request(pagePath);
    assert(first.response.ok && first.response.headers.get("x-cache") === "MISS", "Cold list request was not a cache MISS");
    const second = await request(pagePath);
    assert(second.response.ok && second.response.headers.get("x-cache") === "HIT", "Repeated list request was not a cache HIT");

    const invalid = await request("/projects/0/work-items", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "invalid" })
    });
    assert(invalid.response.status === 400, "Invalid project ID did not return 400");

    const created = await request(`/projects/${temporaryProjectId}/work-items`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: unique })
    });
    assert(created.response.status === 201 && created.body.workItem?.id, "Work-item create failed");
    createdId = created.body.workItem.id;

    const afterCreate = await request(pagePath);
    assert(afterCreate.response.ok && afterCreate.response.headers.get("x-cache") === "MISS", "Create did not invalidate the list cache");
    assert(afterCreate.body.data.some((item) => String(item.id) === String(createdId)), "Created row is absent from list");

    const read = await request(`/work-items/${createdId}`);
    assert(read.response.ok && read.body.workItem.title === unique, "Read-by-ID returned the wrong work item");
    const update = await request(`/work-items/${createdId}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: `${unique}-updated` })
    });
    assert(update.response.ok && update.body.workItem.title === `${unique}-updated`, "Update failed");
    const afterUpdate = await request(pagePath);
    assert(afterUpdate.response.headers.get("x-cache") === "MISS", "Update did not invalidate the list cache");
    assert(afterUpdate.body.data.some((item) => item.title === `${unique}-updated`), "Updated title is absent from list");

    const cursorPage = await request("/work-items?cursor=&limit=2");
    assert(cursorPage.response.ok && Array.isArray(cursorPage.body.data) && "has_more" in cursorPage.body, "Cursor first-page request failed");
    const numericPage = await request("/work-items?page=1&limit=2");
    assert(numericPage.response.ok && numericPage.body.page === 1, "Offset pagination request failed");

    const removed = await request(`/work-items/${createdId}`, { method: "DELETE" });
    assert(removed.response.ok && String(removed.body.workItem.id) === String(createdId), "Delete failed");
    createdId = undefined;
    const afterDelete = await request(pagePath);
    assert(afterDelete.response.headers.get("x-cache") === "MISS", "Delete did not invalidate the list cache");
    assert(!afterDelete.body.data.some((item) => String(item.id) === String(removed.body.workItem.id)), "Deleted row remains in list");

    const missingUpdate = await request(`/work-items/${removed.body.workItem.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "missing" })
    });
    const missingDelete = await request(`/work-items/${removed.body.workItem.id}`, { method: "DELETE" });
    assert(missingUpdate.response.status === 404 && missingDelete.response.status === 404, "Missing-item mutations did not return 404");

    const knownRecord = await request("/work-items/500300");
    console.log(`GET /work-items/500300: HTTP ${knownRecord.response.status}`);
    const projectDelete = await request(`/projects/${temporaryProjectId}`, { method: "DELETE" });
    assert(projectDelete.response.ok, "Temporary project delete failed");
    temporaryProjectId = undefined;
    result = `API validation passed; temporary project and work item ${removed.body.workItem.id} cleaned up.`;
} finally {
    if (createdId !== undefined) {
        try { await request(`/work-items/${createdId}`, { method: "DELETE" }); }
        catch (error) { console.error(`Cleanup failed for temporary work item ${createdId}: ${error.message}`); }
    }
    if (temporaryProjectId !== undefined) {
        try { await request(`/projects/${temporaryProjectId}`, { method: "DELETE" }); }
        catch (error) { console.error(`Cleanup failed for temporary project ${temporaryProjectId}: ${error.message}`); }
    }
}
console.log(result);
