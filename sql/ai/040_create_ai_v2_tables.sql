-- V2専用：会話スレッドテーブル
CREATE TABLE IF NOT EXISTS ai_conversations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title VARCHAR(100) NOT NULL DEFAULT '新しい会話',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 会話一覧の並び順（更新日時降順・ID降順）高速化インデックス
CREATE INDEX IF NOT EXISTS idx_ai_conversations_updated_at_desc
  ON ai_conversations(updated_at DESC, id DESC);

-- V2専用：会話の1往復（質問＋回答）テーブル
CREATE TABLE IF NOT EXISTS ai_conversation_turns (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  user_message TEXT NOT NULL,
  model_message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_v2_user_message_not_empty CHECK (char_length(btrim(user_message)) > 0),
  CONSTRAINT chk_v2_model_message_not_empty CHECK (char_length(btrim(model_message)) > 0)
);

-- 会話IDごとの履歴・直近往復取得高速化インデックス
CREATE INDEX IF NOT EXISTS idx_ai_conversation_turns_conv_id_id
  ON ai_conversation_turns(conversation_id, id DESC);