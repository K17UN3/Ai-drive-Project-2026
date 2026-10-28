CREATE TABLE IF NOT EXISTS todo_tasks (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL CHECK (
    char_length(title) BETWEEN 1 AND 100
    AND char_length(btrim(title)) > 0
  ),
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TODOデータ保存用テーブル定義
CREATE TABLE IF NOT EXISTS todo_tasks (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_title_length CHECK (char_length(title) >= 1 AND char_length(title) <= 100)
);