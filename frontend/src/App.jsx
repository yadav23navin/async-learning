import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { workItemQueries, workItemKeys } from './lib/workItemQueries'
import './App.css'

const initialFilters = {
  q: '',
  state: '',
  assignee_id: '',
  project_id: '',
  priority: '',
  created_from: '',
  created_to: '',
  label: '',
  size: '20',
  cursor: '',
}

function App() {
  const queryClient = useQueryClient()

  const [filters, setFilters] = useState(initialFilters)
  const [page, setPage] = useState(1)
  const [limit] = useState(20)
  const [sort] = useState('created_at_desc')
  const [reversed, setReversed] = useState(false)

  const isSearching = Object.entries(filters).some(
    ([key, value]) => 
      key !== 'size' && 
    key !== 'cursor' && 
    String(value).trim() !== '',
  )

  const listParams = useMemo(
    () => ({ page, limit, sort }),
    [page, limit, sort],
  )

  const searchParams = useMemo(
    () => ({ ...filters, q: filters.q.trim() }),
    [filters],
  )

  const listQuery = useQuery({
    ...workItemQueries.list(listParams),
    enabled: !isSearching,
  })

  const searchQuery = useQuery({
    ...workItemQueries.search(searchParams),
    enabled: isSearching,
  })

  const activeQuery = isSearching ? searchQuery : listQuery

  const items = isSearching
    ? activeQuery.data?.data?.items ?? []
    : activeQuery.data?.data ?? []

  const visibleItems = reversed ? [...items].reverse() : items

  function updateFilter(name, value) {
    setFilters((current) => ({
      ...current,
      [name]: value,
      cursor: '',
    }))
  }

  function editFirstItem() {
    if (!items.length) return

    const editedId = items[0].id
    const update = (old) => {
      if (!old) return old

      if (isSearching) {
        return {
          ...old,
          data: {
            ...old.data,
            items: old.data.items.map((item) =>
              item.id === editedId
                ? { ...item, title: `${item.title} (edited)` }
                : item,
            ),
          },
        }
      }

      return {
        ...old,
        data: old.data.map((item) =>
          item.id === editedId
            ? { ...item, title: `${item.title} (edited)` }
            : item,
        ),
      }
    }

    queryClient.setQueryData(
      isSearching
        ? workItemKeys.search(searchParams)
        : workItemKeys.list(listParams),
      update,
    )
  }

  function clearFilters() {
    setFilters(initialFilters)
    setPage(1)
  }

  return (
    <main>
      <h1>MiniTrack Work Items</h1>
      <p>TanStack Query demo</p>

      <label htmlFor="filter">Search title</label>
      <input
        id="filter"
        value={filters.q}
        onChange={(event) => updateFilter('q', event.target.value)}
        placeholder="Search work items..."
      />

      <h3>Search filters</h3>

      {[
        ['state', 'State'],
        ['assignee_id', 'Assignee ID'],
        ['project_id', 'Project ID'],
        ['priority', 'Priority'],
        ['created_from', 'Created from'],
        ['created_to', 'Created to'],
        ['label', 'Label'],
      ].map(([name, label]) => (
        <label key={name}>
          {label}
          <input
            value={filters[name]}
            onChange={(event) => updateFilter(name, event.target.value)}
            placeholder={label}
          />
        </label>
      ))}

      <div className="actions">
        <button onClick={clearFilters}>Clear filters</button>
        <button onClick={editFirstItem}>Edit first item</button>
        <button onClick={() => setReversed((value) => !value)}>
          Reverse list
        </button>
      </div>

      <p>Query status: {activeQuery.status}</p>
      <p>Fetching: {activeQuery.isFetching ? 'Yes' : 'No'}</p>

      {activeQuery.isPending && <p>Loading work items...</p>}

      {activeQuery.isError && (
        <p role="alert">Error: {activeQuery.error.message}</p>
      )}

      {activeQuery.isSuccess && items.length === 0 && (
        <p>No work items found.</p>
      )}

      {activeQuery.isSuccess && items.length > 0 && (
        <>
          <p>Showing {items.length} work items</p>

          <ul>
            {visibleItems.map((item) => (
              <li key={item.id}>
                <strong>#{item.id}</strong> {item.title}
                <input placeholder="Temporary row note" />
              </li>
            ))}
          </ul>
        </>
      )}

      {!isSearching && (
        <div className="actions">
          <button
            disabled={page === 1}
            onClick={() => setPage((current) => current - 1)}
          >
            Previous
          </button>
          <span>Page {page}</span>
          <button
            disabled={
              !listQuery.data ||
              page >= listQuery.data.total_pages
            }
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </button>
        </div>
      )}
    </main>
  )
}

export default App
