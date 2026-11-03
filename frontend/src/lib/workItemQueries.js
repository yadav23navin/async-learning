import { queryProfiles } from './queryProfiles'

async function fetchApi(url, signal) {
  const response = await fetch(url, { signal })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return response.json()
}

export const workItemKeys = {
  all: ['work-items'],
  lists: () => [...workItemKeys.all, 'list'],
  list: (params) => [...workItemKeys.lists(), params],
  infinite:(params) =>[...workItemKeys.lists(),'infinite', params],
  searches: () => [...workItemKeys.all, 'search'],
  search: (params) => [...workItemKeys.searches(), params],
}

export const workItemQueries = {
  list: (params) => ({
    queryKey: workItemKeys.list(params),
    queryFn: ({ signal }) => {
      const searchParams = new URLSearchParams(params)
      return fetchApi(`/api/work-items?${searchParams}`, signal)
    },
    ...queryProfiles.live,
  }),

  infinite:(params) =>({
    queryKey: workItemKeys.infinite(params),
    initialPageParam:'',
    queryFn:({pageParam,signal}) =>{
        const searchParams=new URLSearchParams({
            limit:String(params.limit ?? 20),
            cursor:pageParam ?? '',
        })
        return fetchApi(`/api/work-items?${searchParams}`,signal)
    },
    getNextPageParam:(lastPage)=>lastPage.has_more ? lastPage.next_cursor:undefined,
    ...queryProfiles.live,
  }),

  search: (params) => ({
    queryKey: workItemKeys.search(params),
    queryFn: ({ signal }) => {
      const searchParams = new URLSearchParams(
        Object.entries(params).filter(
          ([, value]) => value !== undefined && value !== null && value !== '',
        ),
      )

      return fetchApi(`/api/search?${searchParams}`, signal)
    },
    ...queryProfiles.search,
  }),
}