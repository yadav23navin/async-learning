export const queryProfiles = {
  reference: {
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000,
  },
  live: {
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  },
  search: {
    staleTime: 10 * 1000,
    gcTime: 5 * 60 * 1000,
  },
}
