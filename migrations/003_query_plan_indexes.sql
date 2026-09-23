CREATE INDEX idx_work_items_project_created_at
ON work_items(project_id, created_at DESC);