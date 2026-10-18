const createProjectController = ({ projectService }) => {
    const create = async (req, res) => {
        const project = await projectService.create(req.body.name);

        res.status(201).json({
            success: true,
            project
        });
    };

    const findAll = async (req, res) => {
        const projects = await projectService.findAll();

        res.json({
            success: true,
            projects
        });
    };

    const findById = async (req, res) => {
        const project = await projectService.findById(
            Number(req.params.id)
        );

        res.json({
            success: true,
            project
        });
    };

    const update = async (req, res) => {
        const project = await projectService.update(
            Number(req.params.id),
            req.body
        );

        res.json({
            success: true,
            project
        });
    };

    const remove = async (req, res) => {
        const project = await projectService.remove(
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
