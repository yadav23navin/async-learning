const items = Array.from({ length: 50 }, (_, i) => i + 1);

function fetchAndCompute(item) {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(`processed item ${item}`);
        }, 100);
    });
}

async function sequential(itemsToProcess) {
    const results = [];

    for (const item of itemsToProcess) {
        results.push(await fetchAndCompute(item));
    }

    return results;
}

async function promiseAll(itemsToProcess) {
    const promises = itemsToProcess.map((item) => {
        return fetchAndCompute(item);
});
const results = await Promise.all(promises);
return results;
}

async function concurrencyPool(itemsToProcess, limit) {
    const results = [];

    for (let i = 0; i < itemsToProcess.length; i += limit) {
        const batch = itemsToProcess.slice(i, i + limit);

        const batchResults = await Promise.all(
            batch.map((item) => fetchAndCompute(item))
        );

        results.push(...batchResults);
    }

    return results;
}

async function forEachAsync(itemsToProcess) {
    const results = [];

    itemsToProcess.forEach(async (item) => {
        const result = await fetchAndCompute(item);
        results.push(result);
    });

    return results;
}

//console.time("sequential");
//const results = await sequential(items);
//console.timeEnd("sequential");

//console.time("promiseAll");
//const results=await promiseAll(items);
//console.timeEnd("promiseAll");

//console.time("concurrencyPool");
//const results = await concurrencyPool(items, 5);
//console.timeEnd("concurrencyPool");

console.time("forEachAsync");
const results = await forEachAsync(items);
console.timeEnd("forEachAsync");

console.log(results.length);