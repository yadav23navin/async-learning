const createDashboardService = ({ dashboardRepository }) => {
    const getDashboard = async () => {
        const [
            itemsByState,
            itemsByAssignee,
            itemsPerDay,
            averagePointsByProject,
            distinctAssignees
        ] = await Promise.all([
            dashboardRepository.countByState(),
            dashboardRepository.countByAssigneeDefault(),
            dashboardRepository.itemsCreatedPerDay(),
            dashboardRepository.averagePointsByProject(),
            dashboardRepository.countDistinctAssignees()
        ]);

        return {
            itemsByState,
            itemsByAssignee,
            itemsPerDay,
            averagePointsByProject,
            distinctAssignees
        };
    };

    return { getDashboard };
};

export default createDashboardService;