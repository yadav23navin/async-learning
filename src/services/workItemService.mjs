import AppError from "../AppError.mjs";
import escapeHtml from "../sanitize.mjs";
import { buildInvalidationSet } from "../cacheInvalidation.mjs";
import { invalidateCacheKeys } from "../cacheInvalidation.mjs";

const createWorkItemService = ({
    workItemRepository,
    projectRepository,
    invalidateKeys = invalidateCacheKeys
}) => {
    const invalidate = async (projectId, operation) => {
        try {
            await invalidateKeys(buildInvalidationSet("workItem", { projectId, operation }));
        } catch (cause) {
            const error = new AppError(
                "The work-item write succeeded, but cache invalidation failed. The record is committed; check it before retrying.",
                503,
                "CACHE_INVALIDATION_ERROR"
            );
            error.writeCommitted = true;
            error.cause = cause;
            throw error;
        }
    };

    const create = async (projectId, title) => {
        const project = await projectRepository.findById(projectId);

        if (!project) {
            throw new AppError(
                "Project with the requested ID does not exist",
                404,
                "NOT_FOUND"
            );
        }

        const workItem = {
            project_id: projectId,
            title: escapeHtml(title)
        };

        const created = await workItemRepository.create(workItem);
        await invalidate(projectId, "create");
        return created;
    };

    const findAll =async ({page,limit,sort}) => {
        return await workItemRepository.findAll({
            page, limit, sort                                  // now service will support pagination and sorting, so it can pass page, limit, and sort parameters to the repository    
        });
    };

    const findAllCursor = async ({ cursor, limit }) => {
    return await workItemRepository.findAllCursor({
        cursor,
        limit
    });
};

    const findById = async(id) => {
        const workItem = await workItemRepository.findById(id);

        if (!workItem) {
            throw new AppError(
                "Work item with the requested ID does not exist",
                404,
                "NOT_FOUND"
            );
        }

        return workItem;
    };

    const update = async (id, data) => {
        const sanitizedData = {};

        if (data.title !== undefined) {
            sanitizedData.title = escapeHtml(data.title);
        }

        const workItem = await workItemRepository.update(id, sanitizedData);

        if (!workItem) {
            throw new AppError(
                "Work item with the requested ID does not exist",
                404,
                "NOT_FOUND"
            );
        }

        await invalidate(workItem.project_id ?? workItem.projectId, "update-title");
        return workItem;
    };

    const remove = async (id) => {
        const workItem = await workItemRepository.remove(id);

        if (!workItem) {
            throw new AppError(
                "Work item with the requested ID does not exist",
                404,
                "NOT_FOUND"
            );
        }

        await invalidate(workItem.project_id ?? workItem.projectId, "delete");
        return workItem;
    };

    return {
        create,
        findAll,
        findById,
        update,
        remove,
        findAllCursor
    };
};

export default createWorkItemService;
