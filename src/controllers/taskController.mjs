import taskService from "../services/taskService.mjs";

const create = async (req, res) => {
    const task = await taskService.create(req.body.title);

    res.status(201).json({
        success: true,
        task
    });
};

const findAll = (req, res) => {
    const tasks = taskService.findAll();

    res.json({
        success: true,
        tasks
    });
};

export default {
    create,
    findAll
};
