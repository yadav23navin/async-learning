import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import redisClient from "../src/redisClient.mjs";
import { withLock } from "../src/withLock.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const [mode, key, label] = process.argv.slice(2);

if (mode === "child") {
    try {
        await redisClient.connect();
        const result = await withLock(key, 5_000, async () => {
            console.log(`${label} ENTER critical section pid=${process.pid}`);
            await delay(1_200);
        });
        console.log(`${label} RESULT acquired=${result.acquired} pid=${process.pid}`);
        await redisClient.quit();
        process.exitCode = 0;
    } catch (error) {
        console.error(`${label} ERROR ${error.message}`);
        if (redisClient.isOpen) await redisClient.quit().catch(() => {});
        process.exitCode = 1;
    }
} else {
    const keyName = `proof:with-lock:${randomUUID()}`;
    const children = ["A", "B"].map((name) => spawn(process.execPath, [scriptPath, "child", keyName, name], {
        stdio: ["ignore", "pipe", "pipe"]
    }));
    const timeout = setTimeout(() => {
        console.error("PROOF FAILED: child processes did not finish within 20 seconds (check Redis connectivity)");
        for (const child of children) child.kill("SIGTERM");
    }, 20_000);
    const outputs = await Promise.all(children.map((child) => new Promise((resolve) => {
        let stdout = "", stderr = "";
        child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; process.stdout.write(chunk); });
        child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; process.stderr.write(chunk); });
        child.on("close", (code) => resolve({ code, stdout, stderr }));
        child.on("error", (error) => resolve({ code: 1, stdout, stderr: String(error) }));
    })));
    clearTimeout(timeout);
    const entries = outputs.flatMap((result) => result.stdout.match(/ENTER critical section/g) ?? []).length;
    const acquired = outputs.flatMap((result) => result.stdout.match(/RESULT acquired=true/g) ?? []).length;
    const refused = outputs.flatMap((result) => result.stdout.match(/RESULT acquired=false/g) ?? []).length;
    if (outputs.some((result) => result.code !== 0) || entries !== 1 || acquired !== 1 || refused !== 1) {
        console.error(`PROOF FAILED entries=${entries} acquired=${acquired}`);
        process.exitCode = 1;
    } else {
        console.log(`PROOF PASSED: exactly one of two processes entered (${keyName})`);
    }
}
