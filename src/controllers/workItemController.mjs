//import workItemService from "../services/workItemService.mjs";

//now the controller  receives its dependency instead of finding it itself.
const createWorkItemController = ({ workItemService }) => {
    const create = (req, res) => {
        const workItem = workItemService.create(
            Number(req.params.projectId),
            req.body.title
        );

        res.status(201).json({
            success: true,
            workItem
        });
    };

    const findAll = (req, res) => {
        const workItems = workItemService.findAll();

        res.json({
            success: true,
            workItems
        });
    };

    const findById = (req, res) => {
        const workItem = workItemService.findById(
            Number(req.params.id)
        );

        res.json({
            success: true,
            workItem
        });
    };

    const update = (req, res) => {
        const workItem = workItemService.update(
            Number(req.params.id),
            req.body
        );

        res.json({
            success: true,
            workItem
        });
    };

    const remove = (req, res) => {
        const workItem = workItemService.remove(
            Number(req.params.id)
        );

        res.json({
            success: true,
            workItem
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

export default createWorkItemController;