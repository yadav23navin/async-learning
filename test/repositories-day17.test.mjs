import test from "node:test";
import assert from "node:assert/strict";
import createProjectRepository from "../src/repositories/projectRepository.mjs";
import createWorkItemRepository from "../src/repositories/workItemRepository.mjs";

test("PostgreSQL project repository awaits DB lookup and returns the database row", async () => {
    const calls = [];
    class FakeClient {
        async connect() { calls.push("connect"); }
        async query(sql, values = []) {
            calls.push({ sql, values });
            if (sql.includes("SELECT id, organization_id, name")) {
                return { rows: [{ id: 42, organization_id: 9, name: "fixture", status: "active" }] };
            }
            return { rows: [] };
        }
        async end() { calls.push("end"); }
    }

    const repository = createProjectRepository({ ClientClass: FakeClient });
    assert.deepEqual(await repository.findById(42), {
        id: 42, organization_id: 9, name: "fixture", status: "active"
    });
    assert.equal(calls[1].values[0], 42);
    assert.equal(calls.at(-1), "end");
});

test("PostgreSQL work-item create, lookup, update, and delete return rows", async () => {
    const statements = [];
    const row = { id: 7301, project_id: 42, title: "fixture", status: "todo", priority: "medium" };
    class FakeClient {
        async connect() {}
        async query(sql, values = []) {
            statements.push({ sql, values });
            if (sql.includes("INSERT INTO work_items")) return { rows: [row] };
            if (sql.includes("SELECT id, project_id")) return { rows: [row] };
            if (sql.includes("UPDATE work_items")) return { rows: [{ ...row, title: values[0] }] };
            if (sql.includes("DELETE FROM work_items")) return { rows: [row] };
            return { rows: [] };
        }
        async end() {}
    }

    const repository = createWorkItemRepository({ ClientClass: FakeClient });
    assert.equal((await repository.create({ project_id: 42, title: "fixture" })).id, 7301);
    assert.equal((await repository.findById(7301)).project_id, 42);
    assert.equal((await repository.update(7301, { title: "changed" })).title, "changed");
    assert.equal((await repository.remove(7301)).id, 7301);
    assert.equal(statements.length, 4);
});
