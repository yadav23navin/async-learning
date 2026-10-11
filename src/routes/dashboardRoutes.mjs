
import express from "express";

const createDashboardRoutes = ({ dashboardController }) => {
    const router = express.Router();

    router.get("/", dashboardController.getDashboard);

    return router;
};

export default createDashboardRoutes;