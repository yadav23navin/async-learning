import http from "node:http";

const limit = 50;

const getPage = (cursor = null) => {
    return new Promise((resolve, reject) => {
        const query = cursor
            ? `/work-items/cursor?limit=${limit}&cursor=${encodeURIComponent(cursor)}`
            : `/work-items/cursor?limit=${limit}`;

        http.get(`http://localhost:3000${query}`, (res) => {
            let body = "";

            res.on("data", (chunk) => {
                body += chunk;
            });

            res.on("end", () => {
                try {
                    resolve(JSON.parse(body));
                } catch (error) {
                    reject(error);
                }
            });
        }).on("error", reject);
    });
};

const seen = new Set();                                    // this will store the IDs of the work items we've seen so far
let duplicates = 0;
let cursor = null;
let page = 0;

while (true) {
    page++;

    const result = await getPage(cursor);

    //check every row in the result for duplicates
    for (const row of result.data) {
        if (seen.has(row.id)) {                                  // if we've seen this ID before, it's a duplicate
            duplicates++;
        }

        seen.add(row.id);                                       //this will add the ID to the set of seen IDs
    }

    cursor = result.next_cursor;                                 // update the cursor for the next page

    if (!result.has_more) {
        break;
    }
}

console.log("\nFinished.");
console.log("Pages:", page);
console.log("Items seen:", seen.size);
console.log("Duplicates:", duplicates);