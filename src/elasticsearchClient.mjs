import { Client } from "@elastic/elasticsearch";

const esClient = new Client({
    node: "http://localhost:9200",
    auth: {
        username: "elastic",
        password: process.env.ES_PASSWORD
    }
});

export default esClient;
