CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE projects (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE project_members (
    project_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member'
        CHECK (role IN ('owner', 'member')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (project_id, user_id),

    FOREIGN KEY (project_id)
        REFERENCES projects(id)
        ON DELETE CASCADE,

    FOREIGN KEY (user_id)
        REFERENCES users(id)                                 
        ON DELETE CASCADE
);

CREATE TABLE work_items (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL,
    assignee_id BIGINT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'todo'
        CHECK (status IN ('todo', 'in_progress', 'done')),
    priority TEXT NOT NULL DEFAULT 'medium'
        CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    FOREIGN KEY (project_id)
        REFERENCES projects(id)
        ON DELETE CASCADE,

    FOREIGN KEY (assignee_id)
        REFERENCES users(id)
        ON DELETE SET NULL
);

CREATE TABLE labels (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE work_item_labels (
    work_item_id BIGINT NOT NULL,
    label_id BIGINT NOT NULL,

    PRIMARY KEY (work_item_id, label_id),

    FOREIGN KEY (work_item_id)
        REFERENCES work_items(id)
        ON DELETE CASCADE,

    FOREIGN KEY (label_id)
        REFERENCES labels(id)
        ON DELETE CASCADE
);

CREATE TABLE comments (
    id BIGSERIAL PRIMARY KEY,
    work_item_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    FOREIGN KEY (work_item_id)
        REFERENCES work_items(id)
        ON DELETE CASCADE,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE RESTRICT
);

CREATE TABLE activities (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL,
    work_item_id BIGINT,
    user_id BIGINT,
    action TEXT NOT NULL
        CHECK (action IN (
            'created',
            'updated',
            'status_changed',
            'assigned',
            'commented',
            'label_added'
        )),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    FOREIGN KEY (project_id)
        REFERENCES projects(id)
        ON DELETE CASCADE,

    FOREIGN KEY (work_item_id)
        REFERENCES work_items(id)
        ON DELETE CASCADE,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE SET NULL
);


CREATE INDEX idx_project_members_user_id
    ON project_members(user_id);

CREATE INDEX idx_work_items_project_id
    ON work_items(project_id);

CREATE INDEX idx_work_items_assignee_id
    ON work_items(assignee_id);

CREATE INDEX idx_work_item_labels_label_id
    ON work_item_labels(label_id);

CREATE INDEX idx_comments_work_item_id
    ON comments(work_item_id);

CREATE INDEX idx_comments_user_id
    ON comments(user_id);

CREATE INDEX idx_activities_project_id
    ON activities(project_id);

CREATE INDEX idx_activities_work_item_id
    ON activities(work_item_id);

CREATE INDEX idx_activities_user_id
    ON activities(user_id);