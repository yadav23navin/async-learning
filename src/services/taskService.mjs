import taskRepository from "../repositories/taskRepository.mjs";
import escapeHtml from "../sanitize.mjs";

const create = (title) => {
    const sanitizedTitle = escapeHtml(title);
    const task = {
        id: Date.now(),
        title: sanitizedTitle
    };

    return taskRepository.create(task);
};

const findAll = () => {
    return taskRepository.findAll();
};

export default {
    create,
    findAll
};