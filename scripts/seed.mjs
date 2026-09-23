import pg from "pg";

const { Client } = pg;

const client = new Client({                                              //creates a new instance of the Client class from the pg module, which is used to connect to a PostgreSQL database.    
    host: "localhost",
    port: 5432,
    database: "minitrack",
    user: "minitrack",
    password: "minitrack"
});

const randomItem = (items) => {
    return items[Math.floor(Math.random() * items.length)];
};

const randomInt = (min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

const chance = (percentage) => {
    return Math.random() < percentage / 100;
};

const projectNames = [
    "String Projects",
    "MusicVerse",
    "MiniTrack"
];

const firstNames = [
    "Aarav",
    "Vivaan",
    "Aditya",
    "Arjun",
    "Kabir",
    "Rohan",
    "Rahul",
    "Kunal",
    "Nikhil",
    "Ananya",
    "Diya",
    "Isha",
    "Meera",
    "Priya",
    "Riya",
    "Sneha",
    "Kavya",
    "Neha",
    "Aditi",
    "Pooja"
];

const labels = [
    "bug",
    "frontend",
    "backend",
    "database",
    "api",
    "documentation",
    "testing",
    "urgent",
    "enhancement",
    "security",
    "performance",
    "ui"
];

const taskTemplates = [
    "Fix {area} issue in {feature}",
    "Implement {feature} support",
    "Update {feature} validation",
    "Improve {feature} performance",
    "Add tests for {feature}",
    "Refactor {area} module",
    "Investigate {feature} failure",
    "Update {feature} documentation",
    "Handle {area} error case",
    "Improve {feature} user experience"
];

const areas = [
    "authentication",
    "database",
    "API",
    "frontend",
    "backend",
    "search",
    "notifications",
    "dashboard",
    "permissions",
    "file upload"
];

const features = [
    "login",
    "task creation",
    "project settings",
    "comments",
    "search",
    "user management",
    "task filters",
    "notifications",
    "activity feed",
    "project dashboard"
];

const comments = [
    "I have started looking into this.",
    "This should be handled in the service layer.",
    "I found the root cause.",
    "Can we add a test for this case?",
    "The fix is ready for review.",
    "This looks good to me.",
    "I will verify this on staging.",
    "We should also check the edge case.",
    "This is related to the API response.",
    "The change has been tested locally."
];

const activityActions = [
    "created",
    "updated",
    "status_changed",
    "assigned",
    "commented",
    "label_added"
];

const createTaskTitle = () => {
    const template = randomItem(taskTemplates);

    return template
        .replace("{area}", randomItem(areas))
        .replace("{feature}", randomItem(features));
};

const seed = async () => {
    await client.connect();                                           //connects our Node.js program to PostgreSQL.

    try {
        await client.query("BEGIN");

        console.log("Clearing existing seed data...");

        await client.query(`
            TRUNCATE
                activities,
                comments,
                work_item_labels,
                labels,
                work_items,
                project_members,
                projects,
                users,
                organizations
            RESTART IDENTITY CASCADE
        `);

        console.log("Creating organization...");

        const organizationResult = await client.query(`
            INSERT INTO organizations (name)
            VALUES ($1)
            RETURNING id
        `, ["MiniTrack Organization"]);

        const organizationId = organizationResult.rows[0].id;

        console.log("Creating 20 users...");

        const users = [];

        for (let i = 0; i < firstNames.length; i++) {
            const name = firstNames[i];
            const email = `${name.toLowerCase()}${i + 1}@minitrack.local`;

            const result = await client.query(`
                INSERT INTO users (name, email)
                VALUES ($1, $2)
                RETURNING id, name, email
            `, [name, email]);

            users.push(result.rows[0]);
        }

        console.log("Creating 3 projects...");

        const projects = [];

        for (const name of projectNames) {
            const result = await client.query(`
                INSERT INTO projects (
                    organization_id,
                    name,
                    description
                )
                VALUES ($1, $2, $3)
                RETURNING id, name
            `, [
                organizationId,
                name,
                `${name} project for MiniTrack development`
            ]);

            projects.push(result.rows[0]);
        }

        console.log("Creating project memberships...");

        for (const project of projects) {
            const shuffledUsers = [...users].sort(
                () => Math.random() - 0.5
            );

            const memberCount = randomInt(8, 15);

            for (let i = 0; i < memberCount; i++) {
                const user = shuffledUsers[i];

                await client.query(`
                    INSERT INTO project_members (
                        project_id,
                        user_id,
                        role
                    )
                    VALUES ($1, $2, $3)
                `, [
                    project.id,
                    user.id,
                    i === 0 ? "owner" : "member"
                ]);
            }
        }

        console.log("Creating labels...");

        const labelRows = [];

        for (const name of labels) {
            const result = await client.query(`
                INSERT INTO labels (name)
                VALUES ($1)
                RETURNING id, name
            `, [name]);

            labelRows.push(result.rows[0]);
        }

        console.log("Creating 500,000 work items...");

        const workItems = [];

        for (let i = 0; i < 500000; i++) {
            const project = randomItem(projects);

            const projectMembersResult = await client.query(`
                SELECT user_id
                FROM project_members
                WHERE project_id = $1
            `, [project.id]);

            const memberIds = projectMembersResult.rows.map(
                (row) => row.user_id
            );

            const assigneeId = chance(15)
                ? null
                : randomItem(memberIds);

            const statusRoll = Math.random();

            let status;

            if (statusRoll < 0.55) {
                status = "todo";
            } else if (statusRoll < 0.85) {
                status = "in_progress";
            } else {
                status = "done";
            }

            const priorityRoll = Math.random();

            let priority;

            if (priorityRoll < 0.50) {
                priority = "medium";
            } else if (priorityRoll < 0.75) {
                priority = "low";
            } else if (priorityRoll < 0.93) {
                priority = "high";
            } else {
                priority = "urgent";
            }

            const title = createTaskTitle();

            const result = await client.query(`
                INSERT INTO work_items (
                    project_id,
                    assignee_id,
                    title,
                    description,
                    status,
                    priority
                )
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id, project_id, assignee_id, status
            `, [
                project.id,
                assigneeId,
                title,
                `Detailed work item for ${project.name}. This task was generated by the MiniTrack seed script.`,
                status,
                priority
            ]);

            workItems.push(result.rows[0]);

            if ((i + 1) % 5000 === 0) {                                            //it controls how often the progress message is printed to the console.
                console.log(`Created ${i + 1} work items...`);
            }
        }

        console.log("Adding labels to work items...");

        for (const workItem of workItems) {
            const numberOfLabels = randomInt(1, 3);

            const shuffledLabels = [...labelRows].sort(
                () => Math.random() - 0.5
            );

            for (let i = 0; i < numberOfLabels; i++) {
                await client.query(`
                    INSERT INTO work_item_labels (
                        work_item_id,
                        label_id
                    )
                    VALUES ($1, $2)
                `, [
                    workItem.id,
                    shuffledLabels[i].id
                ]);
            }
        }

        console.log("Creating comments...");

        for (const workItem of workItems) {
            if (!chance(35)) {
                continue;
            }

            const commentCount = randomInt(1, 3);

            for (let i = 0; i < commentCount; i++) {
                const user = randomItem(users);

                await client.query(`
                    INSERT INTO comments (
                        work_item_id,
                        user_id,
                        body
                    )
                    VALUES ($1, $2, $3)
                `, [
                    workItem.id,
                    user.id,
                    randomItem(comments)
                ]);
            }
        }

        console.log("Creating activities...");

        for (const workItem of workItems) {
            const activityCount = randomInt(1, 4);

            for (let i = 0; i < activityCount; i++) {
                const user = randomItem(users);
                const action = randomItem(activityActions);

                let metadata = {};

                if (action === "status_changed") {
                    metadata = {
                        old_status: randomItem([
                            "todo",
                            "in_progress"
                        ]),
                        new_status: workItem.status
                    };
                }

                if (action === "assigned") {
                    metadata = {
                        assignee_id: workItem.assignee_id
                    };
                }

                if (action === "label_added") {
                    metadata = {
                        label_id: randomItem(labelRows).id
                    };
                }

                await client.query(`
                    INSERT INTO activities (
                        project_id,
                        work_item_id,
                        user_id,
                        action,
                        metadata
                    )
                    VALUES ($1, $2, $3, $4, $5)
                `, [
                    workItem.project_id,
                    workItem.id,
                    user.id,
                    action,
                    JSON.stringify(metadata)
                ]);
            }
        }

        await client.query("COMMIT");

        console.log("");
        console.log("Seed completed successfully.");
        console.log(`Organization: ${organizationId}`);
        console.log(`Users: ${users.length}`);
        console.log(`Projects: ${projects.length}`);
        console.log(`Work items: ${workItems.length}`);
        console.log(`Labels: ${labelRows.length}`);
    } catch (error) {
        await client.query("ROLLBACK");

        console.error("Seed failed.");
        console.error(error);

        process.exitCode = 1;
    } finally {
        await client.end();
    }
};

seed();