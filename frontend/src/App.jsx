import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { workItemQueries, workItemKeys } from './lib/workItemQueries'
import { useUpdateWorkItem } from './lib/useUpdateWorkItem'
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
  const updateMutation = useUpdateWorkItem()

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
    setPage(1)
  }

  function editFirstItem() {
    if (!items.length || updateMutation.isPending) return

    const item = items[0]

    updateMutation.mutate({
      id: item.id,
      title: `${item.title.replace(/ \(edited\)$/, '')} (edited)`,
    })
  }

  function clearFilters() {
    setFilters(initialFilters)
    setPage(1)
  }

  function retryQuery() {
    activeQuery.refetch()
  }

  function showCreateAction() {
    setFilters(initialFilters)
    setPage(1)
    document.getElementById('filter')?.focus()
  }

  return (
    <main className="app">
      <header className="app-header">
        <div>
          <p className="eyebrow">MINITRACK · PROJECT MANAGEMENT</p>
          <h1>Work Items</h1>
          <p className="subtitle">Search, filter and manage your work.</p>
        </div>
        <span className="status-pill">TanStack Query v5</span>
      </header>

      <section className="toolbar">
        <label className="search-field" htmlFor="filter">
          Search title
          <input
            id="filter"
            value={filters.q}
            onChange={(event) => updateFilter('q', event.target.value)}
            placeholder="Search work items..."
          />
        </label>

        <div className="filters">
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
        </div>

        <div className="actions">
          <button className="secondary" onClick={clearFilters}>
            Clear filters
          </button>
          <button
            onClick={editFirstItem}
            disabled={!items.length || updateMutation.isPending}
          >
            {updateMutation.isPending ? 'Saving...' : 'Edit first item'}
          </button>
          <button className="secondary" onClick={() => setReversed((value) => !value)}>
            Reverse list
          </button>
        </div>

        {updateMutation.isError && (
          <p className="error-message" role="alert">
            Update failed: {updateMutation.error.message}
          </p>
        )}
        {updateMutation.isSuccess && (
          <p className="success-message">Work item updated successfully.</p>
        )}
      </section>

      <section className="results">
        <div className="results-heading">
          <div>
            <h2>Results</h2>
            <p className="muted">
              {activeQuery.isFetching ? 'Refreshing data...' : 'Your latest work items'}
            </p>
          </div>
          <span className="count">{items.length} items</span>
        </div>

        {activeQuery.isPending && (
          <div className="skeleton-list" aria-label="Loading work items">
            {Array.from({ length: 5 }).map((_, index) => (
              <div className="skeleton-row" key={index}>
                <div className="skeleton-id" />
                <div className="skeleton-title" />
              </div>
            ))}
          </div>
        )}

        {activeQuery.isError && (
          <div className="state-panel">
            <h3>Couldn't load work items</h3>
            <p>{activeQuery.error.message}</p>
            <button onClick={retryQuery}>Try again</button>
          </div>
        )}

        {activeQuery.isSuccess && items.length === 0 && (
          <div className="state-panel">
            <h3>No work items found</h3>
            <p>Try changing your search or clearing the filters.</p>
            <button onClick={showCreateAction}>Clear filters and start again</button>
          </div>
        )}

        {activeQuery.isSuccess && items.length > 0 && (
          <ul className="work-item-list">
            {visibleItems.map((item) => (
              <li className="work-item" key={item.id}>
                <span className="item-id">#{item.id}</span>
                <span className="item-title">{item.title}</span>
                <input aria-label={`Temporary note for work item ${item.id}`} placeholder="Temporary row note" />
              </li>
            ))}
          </ul>
        )}

        {!isSearching && (
          <div className="pagination">
            <button
              className="secondary"
              disabled={page === 1}
              onClick={() => setPage((current) => current - 1)}
            >
              Previous
            </button>
            <span>Page {page}</span>
            <button
              className="secondary"
              disabled={!listQuery.data || page >= listQuery.data.total_pages}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </button>
          </div>
        )}
      </section>

      <footer className="debug-info">
        <span>Query status: {activeQuery.status}</span>
        <span>Fetching: {activeQuery.isFetching ? 'Yes' : 'No'}</span>
      </footer>
    </main>
  )
}

export default App