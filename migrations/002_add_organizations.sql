CREATE TABLE organizations (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE projects
ADD COLUMN organization_id BIGINT NOT NULL
    REFERENCES organizations(id)
    ON DELETE CASCADE;

CREATE INDEX idx_projects_organization_id
    ON projects(organization_id);