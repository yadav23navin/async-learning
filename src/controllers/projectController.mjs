const createProjectController = ({ projectService }) => {
    const create = (req, res) => {
        const project = projectService.create(req.body.name);

        res.status(201).json({
            success: true,
            project
        });
    };

    const findAll = (req, res) => {
        const projects = projectService.findAll();

        res.json({
            success: true,
            projects
        });
    };

    const findById = (req, res) => {
        const project = projectService.findById(
            Number(req.params.id)
        );

        res.json({
            success: true,
            project
        });
    };

    const update = (req, res) => {
        const project = projectService.update(
            Number(req.params.id),
            req.body
        );

        res.json({
            success: true,
            project
        });
    };

    const remove = (req, res) => {
        const project = projectService.remove(
            Number(req.params.id)
        );

        res.json({
            success: true,
            project
        });
    };

    return {
        create,
        findAll,
        findById,
        update,
        remove
    };
};

export default createProjectController;