import { queryProfiles } from './queryProfiles'

async function fetchApi(url) {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return response.json()
}

export const workItemKeys = {
  all: ['work-items'],
  list: (params) => ['work-items', 'list', params],
  search: (params) => ['work-items', 'search', params],
}

export const workItemQueries = {
  list: (params) => ({
    queryKey: workItemKeys.list(params),
    queryFn: () => {
      const searchParams = new URLSearchParams(params)
      return fetchApi(`/api/work-items?${searchParams}`)
    },
    ...queryProfiles.workItems,
  }),

  search: (params) => ({
    queryKey: workItemKeys.search(params),
    queryFn: () => {
      const searchParams = new URLSearchParams(
        Object.entries(params).filter(
          ([, value]) => value !== undefined && value !== null && value !== '',
        ),
      )

      return fetchApi(`/api/search?${searchParams}`)
    },
    ...queryProfiles.search,
  }),
}