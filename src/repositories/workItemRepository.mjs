//import workItemRepository from "...";
//import projectRepository from "...";

//this replace the above two lines with the following code Before, the service directly imported both repositories:Now it receives both:
const createWorkItemRepository = () => {
    const workItems = [];

    const create = (workItem) => {
        workItems.push(workItem);
        return workItem;
    };

    const findAll = () => {
        return workItems;
    };

    const findById = (id) => {
        return workItems.find((workItem) => workItem.id === id);
    };

    const update = (id, data) => {
        const workItem = workItems.find(
            (workItem) => workItem.id === id
        );

        if (!workItem) {
            return null;
        }

        Object.assign(workItem, data);

        return workItem;
    };

    const remove = (id) => {
        const index = workItems.findIndex(
            (workItem) => workItem.id === id
        );

        if (index === -1) {
            return null;
        }

        const [deletedWorkItem] = workItems.splice(index, 1);

        return deletedWorkItem;
    };

    return {
        create,
        findAll,
        findById,
        update,
        remove
    };
};

export default createWorkItemRepository;