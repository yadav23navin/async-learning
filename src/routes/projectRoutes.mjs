import express from "express";
import validate from "../validate.mjs";
import {
    createProjectSchema,
    updateProjectSchema
} from "../projectSchemas.mjs";

const createProjectRoutes = ({ projectController }) => {
    const router = express.Router();

    router.post(
        "/",
        validate(createProjectSchema),
        projectController.create
    );

    router.get("/", projectController.findAll);

    router.get("/:id", projectController.findById);

    router.patch(
        "/:id",
        validate(updateProjectSchema),
        projectController.update
    );

    router.delete("/:id", projectController.remove);

    return router;
};

export default createProjectRoutes;