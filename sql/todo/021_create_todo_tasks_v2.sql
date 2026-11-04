CREATE TABLE IF NOT EXISTS v2_todo_tasks (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL CHECK (
    char_length(title) BETWEEN 1 AND 100
    AND char_length(btrim(title)) > 0
  ),
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
