import AppError from "../AppError.mjs";
import escapeHtml from "../sanitize.mjs";

const createProjectService = ({ projectRepository }) => {
    const create = (name) => {
        const sanitizedName = escapeHtml(name);

        const project = {
            id: Date.now(),
            name: sanitizedName
        };

        return projectRepository.create(project);
    };

    const findAll = () => {
        return projectRepository.findAll();
    };

    const findById = (id) => {
        const project = projectRepository.findById(id);

        if (!project) {
            throw new AppError(
                "Project with the requested ID does not exist",
                404,
                "NOT_FOUND"
            );
        }

        return project;
    };

    const update = (id, data) => {
        const sanitizedData = {};

        if (data.name !== undefined) {
            sanitizedData.name = escapeHtml(data.name);
        }

        const project = projectRepository.update(id, sanitizedData);

        if (!project) {
            throw new AppError(
                "Project with the requested ID does not exist",
                404,
                "NOT_FOUND"
            );
        }

        return project;
    };

    const remove = (id) => {
        const project = projectRepository.remove(id);

        if (!project) {
            throw new AppError(
                "Project with the requested ID does not exist",
                404,
                "NOT_FOUND"
            );
        }

        return project;
    };

    return {
        create,
        findAll,
        findById,
        update,
        remove
    };
};

export default createProjectService;