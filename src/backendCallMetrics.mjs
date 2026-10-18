let workItemListFetches = 0;

export function recordWorkItemListFetch() {
    workItemListFetches += 1;
}

export function getBackendCallMetrics() {
    return { workItemListFetches };
}

export function resetBackendCallMetrics() {
    workItemListFetches = 0;
}
