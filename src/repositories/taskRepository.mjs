const tasks = [];

const create = (task) => {
    tasks.push(task);
    return task;
};

const findAll = () => {
    return tasks;
};

export default {
    create,
    findAll
};