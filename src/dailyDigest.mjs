import nodemailer from "nodemailer";
import redisClient from "./redisClient.mjs";
import withLock from "./withLock.mjs";
import createDigestRepository from "./repositories/digestRepository.mjs";

const TIME_ZONE = "Asia/Kolkata";
const TICK_MS = 30_000;
const LOCK_KEY = "daily-digest:lock";
const LOCK_TTL_MS = 10 * 60 * 1000;
const COMPLETED_KEY_PREFIX = "daily-digest:scheduled:";

const once = process.argv.includes("--once");
const dryRun = process.argv.includes("--dry-run");

const repository = createDigestRepository();

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "localhost",
    port: Number(process.env.SMTP_PORT || 1025),
    secure: false
});

const from =
    process.env.NOTIFICATION_EMAIL_FROM || "minitrack@example.test";

function istDateParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date);

    return Object.fromEntries(
        parts
            .filter((part) => part.type !== "literal")
            .map((part) => [part.type, part.value])
    );
}

function istDateString(date = new Date()) {
    const { year, month, day } = istDateParts(date);
    return `${year}-${month}-${day}`;
}

function isNineAmIST(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
    }).formatToParts(date);

    const values = Object.fromEntries(
        parts
            .filter((part) => part.type !== "literal")
            .map((part) => [part.type, part.value])
    );

    return values.hour === "09" && values.minute === "00";
}

function tomorrowIST() {
    const today = istDateString();
    const [year, month, day] = today.split("-").map(Number);

    const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));

    return [
        tomorrow.getUTCFullYear(),
        String(tomorrow.getUTCMonth() + 1).padStart(2, "0"),
        String(tomorrow.getUTCDate()).padStart(2, "0")
    ].join("-");
}

async function runDigest({ scheduledDate = null } = {}) {
    const lock = await withLock(LOCK_KEY, LOCK_TTL_MS, async () => {
        let run = null;
        let usersProcessed = 0;
        let emailsSent = 0;
        const errorDetails = [];
        let fatalError = null;

        try {
            // Skip only if this scheduled date has already completed successfully.
            if (scheduledDate && !dryRun) {
                const completed = await redisClient.get(
                    `${COMPLETED_KEY_PREFIX}${scheduledDate}`
                );
                if (completed === "done") {
                    console.log(
                        `[digest] ${scheduledDate} already completed; skipping`
                    );
                    return { skipped: true };
                }
            }

            run = await repository.createRun();

            const dueDate = tomorrowIST();
            const users = await repository.findUsersWithDueItems(dueDate);

            console.log(
                `[digest] run=${run.id} dueDate=${dueDate} users=${users.length} dryRun=${dryRun}`
            );

            for (const user of users) {
                usersProcessed += 1;

                if (dryRun) {
                    console.log(
                        `[digest] DRY RUN user=${user.user_id} email=${user.email} items=${user.items.length}`
                    );
                    continue;
                }

                const itemList = user.items
                    .map((item) =>
                        `- ${item.title} (ID: ${item.id}, status: ${item.status})`
                    )
                    .join("\n");

                try {
                    await transporter.sendMail({
                        from,
                        to: user.email,
                        subject: `Your work items due tomorrow (${dueDate})`,
                        text:
                            `Hi ${user.name || "there"},\n\n` +
                            `Here is your summary of open work items due tomorrow, ${dueDate}:\n\n` +
                            `${itemList}\n\n` +
                            `You have ${user.items.length} item(s) due tomorrow.`
                    });

                    emailsSent += 1;
                    console.log(
                        `[digest] email sent user=${user.user_id} items=${user.items.length}`
                    );
                } catch (error) {
                    errorDetails.push({
                        userId: user.user_id,
                        message: error.message
                    });

                    console.error(
                        `[digest] email failed user=${user.user_id}: ${error.message}`
                    );
                }
            }
        } catch (error) {
            fatalError = error;
            errorDetails.push({ message: error.message });
            console.error("[digest] run failed:", error.message);
        } finally {
            if (run) {
                const status = fatalError
                    ? "failed"
                    : errorDetails.length > 0
                        ? "partial_failure"
                        : "success";

                try {
                    await repository.finishRun({
                        id: run.id,
                        usersProcessed,
                        emailsSent,
                        errors: errorDetails.length,
                        status,
                        errorDetails
                    });

                    console.log(
                        `[digest] finished run=${run.id} status=${status} users=${usersProcessed} emails=${emailsSent} errors=${errorDetails.length}`
                    );
                } catch (error) {
                    console.error(
                        "[digest] could not save run result:",
                        error.message
                    );
                    throw error;
                }
            }
        }

        if (fatalError) {
            throw fatalError;
        }
        const successful = errorDetails.length === 0;

        if (scheduledDate && !dryRun && successful) {
            await redisClient.set(
                `${COMPLETED_KEY_PREFIX}${scheduledDate}`,
                "done",
                { EX: 60 * 60 * 48 }
            );
        }
        return {
            skipped:false,
            usersProcessed,
            emailsSent,
            errors:errorDetails.length,
        };
    });

    if (!lock.acquired) {
        console.log("[digest] another process holds the lock; skipping tick");
        return;
    }

    return lock.value;
}

async function main() {
    await redisClient.connect();

    if (once) {
        try {
            await runDigest();
        } finally {
            await redisClient.quit();
        }
        return;
    }

    console.log(
        `[digest] scheduler started; daily schedule 09:00 ${TIME_ZONE}; dryRun=${dryRun}`
    );

    let lastCheckedMinute = "";

    const tick = async () => {
        const now = new Date();
        const localDate = istDateString(now);
        const timeParts = new Intl.DateTimeFormat("en-GB", {
            timeZone: TIME_ZONE,
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23"
        }).formatToParts(now);
        const time = Object.fromEntries(
            timeParts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
        );
        const minuteKey = `${localDate}-${time.hour}:${time.minute}`;

        if (minuteKey === lastCheckedMinute) return;
        lastCheckedMinute = minuteKey;

        if (!isNineAmIST(now)) return;

        try {
            await runDigest({ scheduledDate: localDate });
        } catch (error) {
            console.error("[digest] scheduled run error:", error.message);
        }
    };

    await tick();
    setInterval(() => {
        tick().catch((error) => {
            console.error("[digest] tick error:", error.message);
        });
    }, TICK_MS);
}

main().catch(async (error) => {
    console.error("[digest] startup error:", error.message);

    if (redisClient.isOpen) {
        await redisClient.quit().catch(() => {});
    }

    process.exitCode = 1;
});
