const createProjectRepository = () => {
    const projects = [];

    const create = (project) => {
        projects.push(project);
        return project;
    };

    const findAll = () => {
        return projects;
    };

    const findById = (id) => {
        return projects.find((project) => project.id === id);
    };

    const update = (id, data) => {
        const project = projects.find((project) => project.id === id);

        if (!project) {
            return null;
        }

        Object.assign(project, data);

        return project;
    };

    const remove = (id) => {
        const index = projects.findIndex(
            (project) => project.id === id
        );

        if (index === -1) {
            return null;
        }

        const [deletedProject] = projects.splice(index, 1);

        return deletedProject;
    };

    return {
        create,
        findAll,
        findById,
        update,
        remove
    };
};

export default createProjectRepository;