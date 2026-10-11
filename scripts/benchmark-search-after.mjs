import { performance } from "node:perf_hooks";

const BASE_URL = "http://localhost:3000/search";
const QUERY = "";
const PAGE_SIZE = 20;
const TARGET_PAGE = 5000;

async function fetchPage(cursor = null) {
    const url = new URL(BASE_URL);
    url.searchParams.set("q", QUERY);
    url.searchParams.set("size", String(PAGE_SIZE));

    if (cursor) {
        url.searchParams.set("cursor", cursor);
    }

    const start = performance.now();

    const response = await fetch(url);
    const elapsedMs = performance.now() - start;

    if (!response.ok) {
        throw new Error(`Search failed: HTTP ${response.status}`);
    }

    const body = await response.json();

    if (!body.success) {
        throw new Error("Search endpoint returned an error");
    }

    return {
        data: body.data,
        elapsedMs
    };
}

async function main() {
    let cursor = null;
    let page1Ms = null;
    let page5000Ms = null;

    for (let page = 1; page <= TARGET_PAGE; page++) {
        const result = await fetchPage(cursor);

        if (page === 1) {
            page1Ms = result.elapsedMs;
        }

        if (page === TARGET_PAGE) {
            page5000Ms = result.elapsedMs;
        }

        cursor = result.data.nextCursor;

        if (page % 500 === 0 || page === 1) {
            console.log(
                `Page ${page}: ${result.elapsedMs.toFixed(2)} ms`
            );
        }

        if (page < TARGET_PAGE && !cursor) {
            console.log(`No more results after page ${page}.`);
            break;
        }
    }

    console.log("\n--- Benchmark summary ---");
    console.log(`Page 1:     ${page1Ms?.toFixed(2)} ms`);
    console.log(`Page 5000:  ${page5000Ms?.toFixed(2)} ms`);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});