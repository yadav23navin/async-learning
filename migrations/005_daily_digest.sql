
-- Add an optional due date; existing work items remain valid.
ALTER TABLE work_items
ADD COLUMN IF NOT EXISTS due_date DATE;

-- Support efficient lookup of assigned, open items by due date.
CREATE INDEX IF NOT EXISTS idx_work_items_digest_due_date
ON work_items (due_date, assignee_id)
WHERE status IN ('todo', 'in_progress')
  AND assignee_id IS NOT NULL;

-- Record each daily digest execution.
CREATE TABLE IF NOT EXISTS digest_job_runs (
    id BIGSERIAL PRIMARY KEY,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    users_processed INTEGER NOT NULL DEFAULT 0,
    emails_sent INTEGER NOT NULL DEFAULT 0,
    errors INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'success', 'failed', 'partial_failure')),
    error_details JSONB NOT NULL DEFAULT '[]'::jsonb
);
