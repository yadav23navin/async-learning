import {performance} from "node:perf_hooks";

const URL = "http://localhost:3000/work-items?page=1&limit=50";

const TOTAL_REQUESTS = 100;
const latencies = [];
let successful=0;
let failed=0;

for (let i=0; i<TOTAL_REQUESTS; i++){
    const start=performance.now();

    try{
        const response =await fetch(URL);
        await response.arrayBuffer();
        const elapsed=performance.now()-start;

        if(response.ok) {successful++;
        latencies.push(elapsed);
        } else {
            failed++;
            console.error(`Request ${i + 1}: HTTP ${response.status}`);
        }
    }catch(err){
        failed++;
        console.error(`Request ${i+1} failed: ${err.message}`);
    }
}
latencies.sort((a,b)=>a-b);
const percentile = (p) =>
    latencies.length ?latencies[Math.ceil(p * latencies.length)-1].toFixed(2):"N/A";                               

console.log("\n--- Work-items Benchmark ---");
console.log(`URL: ${URL}`);
console.log(`Total requests: ${TOTAL_REQUESTS}`);
console.log(`Successful responses: ${successful}`);
console.log(`Failed requests: ${failed}`);
console.log(`p50 latency: ${percentile(0.50)} ms`);
console.log(`p95 latency: ${percentile(0.95)} ms`);