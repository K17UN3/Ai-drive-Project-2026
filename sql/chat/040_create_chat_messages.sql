-- チャット機能用テーブル定義 (Neon / PostgreSQL)
-- 既存の TOP / TODO / AI テーブルとは独立した構成

-- 1. ルームマスターテーブル（固定2ルーム・席確保時の行ロック対象）
CREATE TABLE IF NOT EXISTS chat_rooms (
  id INTEGER PRIMARY KEY,
  name VARCHAR(30) NOT NULL,
  max_capacity INTEGER NOT NULL DEFAULT 5 CHECK (max_capacity > 0)
);

-- 初期ルームデータの投入（冪等実行可能）
INSERT INTO chat_rooms (id, name, max_capacity)
VALUES
  (1, 'Room 1', 5),
  (2, 'Room 2', 5)
ON CONFLICT (id) DO NOTHING;

-- 2. アクティブ参加席管理テーブル（接続単位・45秒Heartbeatタイムアウト）
CREATE TABLE IF NOT EXISTS chat_seats (
  seat_token UUID PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_seats_room_last_seen
  ON chat_seats (room_id, last_seen_at);

-- 3. チャットメッセージ履歴テーブル（1ルーム最大30件保持・最新20件表示）
CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGSERIAL PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_name VARCHAR(20) NOT NULL CHECK (char_length(btrim(user_name)) BETWEEN 1 AND 20),
  comment VARCHAR(500) NOT NULL CHECK (char_length(btrim(comment)) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_room_id_desc
  ON chat_messages (room_id, id DESC);