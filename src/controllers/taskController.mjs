import taskService from "../services/taskService.mjs";

const create = (req, res) => {
    const task = taskService.create(req.body.title);

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