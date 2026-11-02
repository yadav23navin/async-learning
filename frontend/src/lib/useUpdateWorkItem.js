import { useMutation, useQueryClient } from '@tanstack/react-query'
import { workItemKeys } from './workItemQueries'

export function useUpdateWorkItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, title }) => {
      const response = await fetch(`/api/work-items/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title }),
      })
      if (!response.ok) {
        throw new Error(`Update failed: HTTP ${response.status}`)
      }

      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: workItemKeys.all,
      })
    },
  })
}
