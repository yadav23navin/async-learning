import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useInfiniteQuery } from '@tanstack/react-query'
import { workItemQueries } from './lib/workItemQueries'
import { useWorkItemActions } from './lib/useWorkItemActions'
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
  const actions = useWorkItemActions()

  const [filters, setFilters] = useState(initialFilters)
  const [limit] = useState(20)
  const [reversed, setReversed] = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [createProjectId, setCreateProjectId] = useState('')

  const loadMoreRef = useRef(null)

  const isSearching = Object.entries(filters).some(
    ([key, value]) =>
      key !== 'size' &&
      key !== 'cursor' &&
      String(value).trim() !== '',
  )

  const searchParams = useMemo(
    () => ({ ...filters, q: filters.q.trim() }),
    [filters],
  )

  const infiniteQuery = useInfiniteQuery({
    ...workItemQueries.infinite({ limit }),
    enabled: !isSearching,
  })

  const searchQuery = useQuery({
    ...workItemQueries.search(searchParams),
    enabled: isSearching,
  })

  const activeQuery = isSearching ? searchQuery : infiniteQuery

  const items = isSearching
    ? searchQuery.data?.data?.items ?? []
    : infiniteQuery.data?.pages.flatMap((page) => page.data ?? []) ?? []

  const visibleItems = reversed ? [...items].reverse() : items

  const {
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = infiniteQuery

  useEffect(() => {
    const element = loadMoreRef.current

    if (!element || isSearching || !hasNextPage) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingNextPage) {
          fetchNextPage()
        }
      },
      { rootMargin: '200px' },
    )

    observer.observe(element)

    return () => observer.disconnect()
  }, [
    isSearching,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  ])

  function updateFilter(name, value) {
    setFilters((current) => ({
      ...current,
      [name]: value,
      cursor: '',
    }))
  }

  function clearFilters() {
    setFilters(initialFilters)
  }

  function editItem(item) {
    const title =
      item.title.replace(/ \(edited\)$/, '') + ' (edited)'

    actions.updateItem(item.id, title)
  }

  function createItem(event) {
    event.preventDefault()

    if (!createProjectId || !createTitle.trim()) return

    actions.createItem(Number(createProjectId), createTitle.trim())
    setCreateTitle('')
  }

  function retryQuery() {
    activeQuery.refetch()
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

      {actions.toast && (
        <div
          className={
            actions.toast.type === 'error'
              ? 'error-message'
              : 'success-message'
          }
          role="alert"
        >
          {actions.toast.message}
          <button
            className="secondary"
            onClick={actions.dismissToast}
          >
            Dismiss
          </button>
        </div>
      )}

      <section className="toolbar">
        <form className="actions" onSubmit={createItem}>
          <label>
            Project ID
            <input
              type="number"
              min="1"
              value={createProjectId}
              onChange={(event) =>
                setCreateProjectId(event.target.value)
              }
              placeholder="Project ID"
              required
            />
          </label>

          <label>
            New work item
            <input
              value={createTitle}
              onChange={(event) =>
                setCreateTitle(event.target.value)
              }
              placeholder="Work item title"
              required
            />
          </label>

          <button disabled={actions.isPending}>
            Create item
          </button>
        </form>

        <label className="search-field" htmlFor="filter">
          Search title
          <input
            id="filter"
            value={filters.q}
            onChange={(event) =>
              updateFilter('q', event.target.value)
            }
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
                onChange={(event) =>
                  updateFilter(name, event.target.value)
                }
                placeholder={label}
              />
            </label>
          ))}
        </div>

        <div className="actions">
          <button
            className="secondary"
            onClick={clearFilters}
          >
            Clear filters
          </button>

          <button
            className="secondary"
            onClick={() =>
              setReversed((value) => !value)
            }
          >
            Reverse list
          </button>
        </div>
      </section>

      <section className="results">
        <div className="results-heading">
          <div>
            <h2>Results</h2>
            <p className="muted">
              {activeQuery.isFetching
                ? 'Refreshing data...'
                : 'Your latest work items'}
            </p>
          </div>

          <span className="count">
            {items.length} items loaded
          </span>
        </div>

        {activeQuery.isPending && (
          <div
            className="skeleton-list"
            aria-label="Loading work items"
          >
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
            <button onClick={clearFilters}>Clear filters</button>
          </div>
        )}

        {activeQuery.isSuccess && items.length > 0 && (
          <ul className="work-item-list">
            {visibleItems.map((item) => (
              <li className="work-item" key={item.id}>
                <span className="item-id">#{item.id}</span>
                <span className="item-title">{item.title}</span>

                <div className="actions">
                  <button
                    className="secondary"
                    disabled={actions.isPending || item.optimistic}
                    onClick={() => editItem(item)}
                  >
                    Edit
                  </button>

                  <button
                    className="secondary"
                    disabled={actions.isPending || item.optimistic}
                    onClick={() => actions.deleteItem(item.id)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {!isSearching && (
          <div
            ref={loadMoreRef}
            className="pagination"
          >
            {infiniteQuery.isFetchingNextPage && (
              <p>Loading more work items...</p>
            )}

            {!infiniteQuery.hasNextPage && items.length > 0 && (
              <p>You've reached the end of the list.</p>
            )}
          </div>
        )}
      </section>

      <footer className="debug-info">
        <span>Query status: {activeQuery.status}</span>
        <span>
          Fetching: {activeQuery.isFetching ? 'Yes' : 'No'}
        </span>
        <span>Loaded: {items.length}</span>
      </footer>
    </main>
  )
}

export default App