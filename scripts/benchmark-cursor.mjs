import http from "node:http";

const limit = 50;

const getPage = (cursor = null) => {
    return new Promise((resolve, reject) => {
        const query = cursor
            ? `/work-items/cursor?limit=${limit}&cursor=${encodeURIComponent(cursor)}`
            : `/work-items/cursor?limit=${limit}`;

        const start = process.hrtime.bigint();

        http.get(`http://localhost:3000${query}`, (res) => {
            let body = "";

            res.on("data", (chunk) => {
                body += chunk;
            });

            res.on("end", () => {
                const end = process.hrtime.bigint();

                resolve({
                    elapsedMs: Number(end - start) / 1_000_000,
                    data: JSON.parse(body)
                });
            });
        }).on("error", reject);
    });
};

const targetPages = [1, 100, 1000, 5000];

let cursor = null;

for (let page = 1; page <= 5000; page++) {
    const result = await getPage(cursor);

    cursor = result.data.next_cursor;
    if (targetPages.includes(page)) {
        console.log(
            `Page ${page}: ${result.elapsedMs.toFixed(3)} ms`
        );
    }

    if (!result.data.has_more) {
        break;
    }
}