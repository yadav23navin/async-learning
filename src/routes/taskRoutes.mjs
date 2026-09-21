import express from "express";
import taskController from "../controllers/taskController.mjs";

const router = express.Router();

router.post("/", taskController.create);

router.get("/", taskController.findAll);

export default router;