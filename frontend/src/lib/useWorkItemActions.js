import {useState} from 'react'
import {useMutation, useQueryClient} from '@tanstack/react-query'
import {workItemKeys} from './workItemQueries'

async function sendRequest(url,method,body){
    const response=await fetch(url,{
        method,headers:{'Content-Type':'application/Json'},
        ...(body?{body:JSON.stringify(body)}:{}),
    })
    const data=await response.json().catch(()=>({}))
    if(!response.ok){
        throw new Error(data.message ||`Request failed: HTTP ${response.status}`)
    }
    return data
}
 function updateRows(data,updater){
    if(!data || typeof data !=='object') return data

    if(Array.isArray(data.data)){
        return{...data, data:updater(data.data)}
 }

 if(data.data?.items && Array.isArray(data.data.items)){
    return{
        ...data,
        data:{
        ...data.data,
        items:updater(data.data.items),
    },
 }
 }
 if(Array.isArray(data.pages)){
    return{
        ...data,
        pages:data.pages.map((page)=>updateRows(page,updater)),
    }
 }
 return data
}
function updateCachedItems(queryClient, updater) {
  queryClient.setQueriesData(
    { queryKey: workItemKeys.all },
    (oldData) => updateRows(oldData, updater),
  )
}

export function useWorkItemActions() {
  const queryClient = useQueryClient()
  const [toast, setToast] = useState(null)

  const mutation = useMutation({
    mutationFn: async (action) => {
      if (action.type === 'create') {
        return sendRequest(
          `/api/projects/${action.projectId}/work-items`,
          'POST',
          { title: action.title },
        )
      }

      if (action.type === 'update') {
        return sendRequest(
          `/api/work-items/${action.id}`,
          'PATCH',
          { title: action.title },
        )
      }

      if (action.type === 'delete') {
        return sendRequest(
          `/api/work-items/${action.id}`,
          'DELETE',
        )
      }

      throw new Error('Unknown work-item action')
    },

    onMutate: async (action) => {
      await queryClient.cancelQueries({
        queryKey: workItemKeys.all,
      })

      const previousQueries = queryClient.getQueriesData({
        queryKey: workItemKeys.all,
      })

      if (action.type === 'create') {
        const optimisticItem = {
          id: `temp-${Date.now()}`,
          title: action.title,
          project_id: action.projectId,
          optimistic: true,
        }

        updateCachedItems(queryClient, (items) => [
          optimisticItem,
          ...items,
        ])
      }

      if (action.type === 'update') {
        updateCachedItems(queryClient, (items) =>
          items.map((item) =>
            String(item.id) === String(action.id)
              ? { ...item, title: action.title }
              : item,
          ),
        )
      }

      if (action.type === 'delete') {
        updateCachedItems(queryClient, (items) =>
          items.filter(
            (item) => String(item.id) !== String(action.id),
          ),
        )
      }

      return { previousQueries }
    },

    onError: (error, action, context) => {
      context?.previousQueries?.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data)
      })

      setToast({
        type: 'error',
        message: error.message,
      })
    },

    onSuccess: (_data, action) => {
      const messages = {
        create: 'Work item created.',
        update: 'Work item updated.',
        delete: 'Work item deleted.',
      }

      setToast({
        type: 'success',
        message: messages[action.type],
      })
    },

    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: workItemKeys.all,
      })
    },
  })

  return {
    createItem: (projectId, title) =>
      mutation.mutate({ type: 'create', projectId, title }),

    updateItem: (id, title) =>
      mutation.mutate({ type: 'update', id, title }),

    deleteItem: (id) =>
      mutation.mutate({ type: 'delete', id }),

    isPending: mutation.isPending,
    toast,
    dismissToast: () => setToast(null),
  }
}
