import express from "express";

export default function createReferenceRoutes({ searchRepository }) {
    const router = express.Router();

    router.get("/states", async (req, res, next) => {
        try {
            res.json({ data: await searchRepository.getProjectStates() });
        } catch (err) {
            next(err);
        }
    });

    router.get("/labels", async (req, res, next) => {
        try {
            res.json({ data: await searchRepository.getLabels() });
        } catch (err) {
            next(err);
        }
    });

    router.get("/projects/:projectId/members", async (req, res, next) => {
        try {
            res.json({
                data: await searchRepository.getProjectMembers(req.params.projectId)
            });
        } catch (err) {
            next(err);
        }
    });

    return router;
}
