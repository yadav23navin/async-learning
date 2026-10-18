export class FakeRedis {
    constructor() {
        this.values = new Map();
        this.expirations = new Map();
        this.sortedSets = new Map();
    }

    #purge(key) {
        const expires = this.expirations.get(key);
        if (expires !== undefined && expires <= Date.now()) {
            this.values.delete(key);
            this.expirations.delete(key);
        }
    }

    async get(key) {
        this.#purge(key);
        return this.values.get(key) ?? null;
    }

    async set(key, value, options = {}) {
        this.#purge(key);
        if (options.NX && this.values.has(key)) return null;
        this.values.set(key, value);
        if (options.PX) this.expirations.set(key, Date.now() + options.PX);
        else if (options.EX) this.expirations.set(key, Date.now() + options.EX * 1000);
        else this.expirations.delete(key);
        return "OK";
    }

    async del(...keys) {
        const flatKeys = keys.flat();
        let deleted = 0;
        for (const key of flatKeys) {
            this.#purge(key);
            if (this.values.delete(key)) deleted += 1;
            this.expirations.delete(key);
        }
        return deleted;
    }

    async scan(cursor, { MATCH }) {
        const escaped = MATCH.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
        const regex = new RegExp(`^${escaped}$`);
        const keys = [...this.values.keys()].filter((key) => {
            this.#purge(key);
            return regex.test(key);
        });
        return { cursor: "0", keys };
    }

    async eval(script, { keys, arguments: args }) {
        if (script.includes("ZREMRANGEBYSCORE")) {
            const key = keys[0], now = Number(args[0]), window = Number(args[1]), limit = Number(args[2]);
            const members = this.sortedSets.get(key) ?? new Map();
            for (const [member, score] of members) if (score <= now - window) members.delete(member);
            if (members.size >= limit) {
                const oldest = Math.min(...members.values());
                this.expirations.set(key, Date.now() + window);
                return [0, Math.max(1, Math.ceil((oldest + window - now) / 1000))];
            }
            members.set(args[3], now);
            this.sortedSets.set(key, members);
            this.expirations.set(key, Date.now() + window);
            return [1, 0];
        }
        if (await this.get(keys[0]) === args[0]) return this.del(keys[0]);
        return 0;
    }

    async zCard(key) { return this.sortedSets.get(key)?.size ?? 0; }
}
