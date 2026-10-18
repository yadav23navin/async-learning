import AppError from "../AppError.mjs";
import escapeHtml from "../sanitize.mjs";
import { buildInvalidationSet } from "../cacheInvalidation.mjs";
import { invalidateCacheKeys } from "../cacheInvalidation.mjs";

const createProjectService = ({ projectRepository, invalidateKeys = invalidateCacheKeys }) => {
    const invalidateAfterWrite = async (keys) => {
        try {
            await invalidateKeys(keys);
        } catch (cause) {
            const error = new AppError(
                "The project write succeeded, but cache invalidation failed. The record is committed; check it before retrying.",
                503,
                "CACHE_INVALIDATION_ERROR"
            );
            error.writeCommitted = true;
            error.cause = cause;
            throw error;
        }
    };

    const create = async (name) => {
        const sanitizedName = escapeHtml(name);
        const created = await projectRepository.create({ name: sanitizedName });
        await invalidateAfterWrite(buildInvalidationSet("project", { id: created.id, operation: "create" }));
        return created;
    };

    const findAll = async () => {
        return projectRepository.findAll();
    };

    const findById = async (id) => {
        const project = await projectRepository.findById(id);

        if (!project) {
            throw new AppError(
                "Project with the requested ID does not exist",
                404,
                "NOT_FOUND"
            );
        }

        return project;
    };

    const update = async (id, data) => {
        const sanitizedData = {};

        if (data.name !== undefined) {
            sanitizedData.name = escapeHtml(data.name);
        }

        const project = await projectRepository.update(id, sanitizedData);

        if (!project) {
            throw new AppError(
                "Project with the requested ID does not exist",
                404,
                "NOT_FOUND"
            );
        }

        await invalidateAfterWrite(buildInvalidationSet("project", { id, operation: "update" }));
        return project;
    };

    const remove = async (id) => {
        const project = await projectRepository.remove(id);

        if (!project) {
            throw new AppError(
                "Project with the requested ID does not exist",
                404,
                "NOT_FOUND"
            );
        }

        await invalidateAfterWrite(buildInvalidationSet("project", { id, operation: "delete" }));
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
