import express from "express";

const createSearchRoutes = ({ searchController }) => {
    const router = express.Router();

    router.get("/", searchController.searchWorkItems);

    return router;
};

export default createSearchRoutes;