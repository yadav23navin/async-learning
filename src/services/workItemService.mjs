import AppError from "../AppError.mjs";
import escapeHtml from "../sanitize.mjs";

const createWorkItemService = ({
    workItemRepository,
    projectRepository
}) => {
    const create = (projectId, title) => {
        const project = projectRepository.findById(projectId);

        if (!project) {
            throw new AppError(
                "Project with the requested ID does not exist",
                404,
                "NOT_FOUND"
            );
        }

        const workItem = {
            id: Date.now(),
            projectId,
            title: escapeHtml(title)
        };

        return workItemRepository.create(workItem);
    };

    const findAll = () => {
        return workItemRepository.findAll();
    };

    const findById = (id) => {
        const workItem = workItemRepository.findById(id);

        if (!workItem) {
            throw new AppError(
                "Work item with the requested ID does not exist",
                404,
                "NOT_FOUND"
            );
        }

        return workItem;
    };

    const update = (id, data) => {
        const sanitizedData = {};

        if (data.title !== undefined) {
            sanitizedData.title = escapeHtml(data.title);
        }

        const workItem = workItemRepository.update(id, sanitizedData);

        if (!workItem) {
            throw new AppError(
                "Work item with the requested ID does not exist",
                404,
                "NOT_FOUND"
            );
        }

        return workItem;
    };

    const remove = (id) => {
        const workItem = workItemRepository.remove(id);

        if (!workItem) {
            throw new AppError(
                "Work item with the requested ID does not exist",
                404,
                "NOT_FOUND"
            );
        }

        return workItem;
    };

    return {
        create,
        findAll,
        findById,
        update,
        remove
    };
};

export default createWorkItemService;