-- AI対話ログ保存用テーブル定義
CREATE TABLE IF NOT EXISTS ai_qa_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  prompt TEXT NOT NULL,
  response_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_prompt_not_empty CHECK (char_length(btrim(prompt)) > 0)
);

-- 最新履歴取得および検索高速化用インデックス
CREATE INDEX IF NOT EXISTS idx_ai_qa_logs_created_at_desc ON ai_qa_logs(created_at DESC);