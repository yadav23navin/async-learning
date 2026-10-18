import express from "express";
import AppError from "./AppError.mjs";
import errorHandler from "./errorHandler.mjs";
import catchAsync from "./catchAsync.mjs";
import {z} from "zod";
import validate from "./validate.mjs";
import rejectDuplicateKeys from "./rejectDuplicateKeys.mjs";
//import escapeHtml from "./sanitize.mjs";
import taskRoutes from "./routes/taskRoutes.mjs";
//import projectRoutes from "./routes/projectsRoutes.mjs";
//import workItemRoutes from "./routes/workItemRoutes.mjs";
import createProjectRepository from "./repositories/projectRepository.mjs";
import createProjectService from "./services/projectService.mjs";
import createProjectController from "./controllers/projectController.mjs";
import createProjectRoutes from "./routes/projectRoutes.mjs";
import createWorkItemRepository from "./repositories/workItemRepository.mjs";
import createWorkItemService from "./services/workItemService.mjs";
import createWorkItemController from "./controllers/workItemController.mjs";
import createWorkItemRoutes from "./routes/workItemRoutes.mjs";
import logger from "./logger.mjs";
import createDashboardRepository from "./repositories/dashboardRepository.mjs";
import createDashboardService from "./services/dashboardService.mjs";
import createDashboardController from "./controllers/dashboardController.mjs";
import createDashboardRoutes from "./routes/dashboardRoutes.mjs";
import createSearchRepository from "./repositories/searchRepository.mjs";
import createSearchService from "./services/searchService.mjs";
import createSearchController from "./controllers/searchController.mjs";
import createSearchRoutes from "./routes/searchRoutes.mjs";
import createExportRepository from "./repositories/exportRepository.mjs";
import createExportService from "./services/exportService.mjs";
import createExportController from "./controllers/exportController.mjs";
import redisClient from "./redisClient.mjs";
import cacheWorkItemsResponse from "./cacheWorkItemsResponse.mjs";
import createReferenceRoutes from "./routes/referenceRoutes.mjs";
import { getBackendCallMetrics, resetBackendCallMetrics } from "./backendCallMetrics.mjs";


const projectRepository = createProjectRepository();                                   // this is responsible for check project repository

const projectService = createProjectService({                                          // this is responsible for check project service
    projectRepository
});

const projectController = createProjectController({                                   // this is responsible for check project controller
    projectService
});

const projectRoutes = createProjectRoutes({                                            //  this is responsible for check project routes
    projectController
});

const workItemRepository = createWorkItemRepository();

const workItemService = createWorkItemService({
    workItemRepository,
    projectRepository
});

const workItemController = createWorkItemController({
    workItemService
});

const workItemRoutes = createWorkItemRoutes({
    workItemController,
    redis: redisClient
});

const dashboardRepository = createDashboardRepository();

const dashboardService = createDashboardService({
    dashboardRepository
});

const dashboardController = createDashboardController({
    dashboardService
});

const dashboardRoutes = createDashboardRoutes({
    dashboardController
});

const searchRepository = createSearchRepository();
const searchService = createSearchService({ searchRepository });
const searchController = createSearchController({ searchService });
const searchRoutes = createSearchRoutes({ searchController });
const referenceRoutes = createReferenceRoutes({ searchRepository });
const exportRepository = createExportRepository();
const exportService = createExportService({ exportRepository });
const exportController = createExportController({ exportService });

const app = express();
if (process.env.NODE_ENV !== "production") {
    app.get("/__bench/backend-calls", (req, res) => res.json(getBackendCallMetrics()));
    app.post("/__bench/backend-calls/reset", (req, res) => {
        resetBackendCallMetrics();
        res.status(204).end();
    });
}
//const tasks = [];

app.use(logger);

app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));

const validationSchema = z.object({                              // this is responsible for check validation error 
    name:z.string().min(1)

    // this will check if name is a string and not empty and does not contain any HTML tags
    .refine((value) => !/<[^>]*>/.test(value), {
            message: "name must not contain HTML tags"
        })

        //this will check if name is a string and does not contain any null bytes
        .refine((value) => !value.includes("\0"), {
        message: "name must not contain null bytes"
    })

    // this will check if name is a string and does not contain any control characters
    .refine((value) => !/[\u0000-\u001F\u007F]/.test(value), {
    message: "name must not contain control characters"
}),

    limit:z.number().int().positive().optional(),                // this will check if limit is a positive integer and optional 

     filter: z.string()                                          // this will check if filter is a string and does not contain any special characters except underscore
        .regex(/^[a-zA-Z0-9_]+$/, {
            message: "filter contains invalid characters"
        })
        .optional()


}).strict();                                                    // only allowed fields in the request body get accepted, any extra fields will be rejected

//this will check if catchasync catch the error or not from async function
app.get(
    "/async-error",
    catchAsync(async (req, res) => {
        throw new Error("Unexpected async error");
    })
);
//this is responsible for check validation error
{/*app.post("/validation", (req, res) => {
    if (!req.body.name) {
        throw new AppError(
            "Request body is missing the required name field",
            400,
            "VALIDATION_ERROR"
        );
    } */}
app.post("/validation",rejectDuplicateKeys, validate(validationSchema),
    (req, res) => {

    res.json({
        success: true,
        message: "Validation passed"
    });
});
// this is responsible for check unauthenticated error
app.get("/unauthenticated", (req, res) => {
    throw new AppError(
        "No valid authentication token was provided",
        401,
        "UNAUTHENTICATED"
    );
});
// this is responsible for check forbidden error
app.get("/forbidden", (req, res) => {
    throw new AppError(
        "Authenticated user does not have permission to access this resource",
        403,
        "FORBIDDEN"
    );
});
// this is responsible for check not found error
app.get("/not-found", (req, res) => {
    throw new AppError(
        "Project with the requested ID does not exist",
        404,
        "NOT_FOUND"
    );
});
// this is responsible for check conflict error
app.get("/conflict", (req, res) => {
    throw new AppError(
        "A project with the same name already exists",
        409,
        "CONFLICT"
    );
});
// this is responsible for check internal error
app.get("/internal-error", (req, res) => {
    throw new Error(
        "Database connection unexpectedly failed",
    );
}); 

//this will receive a task title, escape any HTML, store the task, and send the stored task back 
{/*app.post("/tasks", (req, res) => {
    const title = escapeHtml(req.body.title);

    const task = {
        id: tasks.length + 1,
        title
    };

    tasks.push(task);

    res.status(201).json({
        success: true,
        task
    });
});  */}
app.use(cacheWorkItemsResponse);
app.use("/tasks", taskRoutes);                                     // this is responsible for check task routes
app.use("/projects", projectRoutes);                                 // this is responsible for check project routes
app.use("/dashboard", dashboardRoutes);                            // this is responsible for check dashboard routes
app.use("/", workItemRoutes);                                     // this is responsible for check work item routes
app.use("/search", searchRoutes);
app.use("/reference", referenceRoutes);                                 // this is responsible for check search routes
app.get("/export", exportController
    .exportWorkItems);app.use(errorHandler);                                            // this is responsible for check error handler


const startServer = async () => {
    try {
        await redisClient.connect();
        console.log("Redis connected");

        const port = Number(process.env.PORT || 3000);
        app.listen(port, () => {
            console.log(`Server running on port ${port}`);
        });
    } catch (err) {
        console.error("Failed to start server:", err.message);
        process.exit(1);
    }
};

startServer();
