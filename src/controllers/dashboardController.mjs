import catchAsync from "../catchAsync.mjs";

const createDashboardController = ({ dashboardService }) => {
    const getDashboard = catchAsync(async (req, res) => {
        const dashboard = await dashboardService.getDashboard();

        res.status(200).json({
            success: true,
            data: dashboard
        });
    });

    return { getDashboard };
};

export default createDashboardController;