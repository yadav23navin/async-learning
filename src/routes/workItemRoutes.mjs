import express from "express";
import validate from "../validate.mjs";
import {
    createWorkItemSchema,
    updateWorkItemSchema
} from "../workItemSchemas.mjs";
//import workItemController from "../controllers/workItemController.mjs";

// now it doesn't call the workItemController directly, instead it will be passed as a dependency

const createWorkItemRoutes = ({ workItemController }) => {
    const router = express.Router();

    router.post(
    "/projects/:projectId/work-items",
    validate(createWorkItemSchema),
    workItemController.create
);

router.get(
    "/work-items",
    workItemController.findAll
);

router.get(
    "/work-items/:id",
    workItemController.findById
);

router.patch(
    "/work-items/:id",
    validate(updateWorkItemSchema),
    workItemController.update
);

router.delete(
    "/work-items/:id",
    
    workItemController.remove
);
return router;
};

export default createWorkItemRoutes;