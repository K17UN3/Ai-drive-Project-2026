# チャット機能 段階的実装手順書 (`docs/chat/04_implementation.md`)

* **対象システム:** Express / TypeScript / EJS / Neon（PostgreSQL）/ Vercel
* **前提ドキュメント:** `docs/chat/02_requirements.md`, `docs/chat/03_design.md`
* **進行方針:** いきなり全機能を作らず、**工程 A → E** の順に「小さな単位で実装 → ブラウザとログで確認 → 次へ進む」サイクルを回す。

> **【重要：ローカル検証と Vercel 本番環境の通信構成について】**
> 1. **ポート二重待機の防止:** 既存の `index.ts` では末尾で `app.listen(PORT, ...)` を実行しています。工程 A で `socket.io` を組み込む際は、既存 `app.listen(PORT)` を生かしたまま `http.createServer(app)` へ一本化し、**同じポートで2回 `listen` しない**よう注意してください。
> 2. **Vercel 本番環境での同期方式:** Vercel（サーバーレス関数）では長時間維持される WebSocket 接続が切断されるため、本番環境でも確実に複数インスタンス同期と「1ルーム5名制限」が動作するよう、メッセージ配信・参加枠管理の本体は **Neon DB を共有基盤とした HTTP API（1.5秒間隔ポーリング）** で実装します。

---

## 工程 A：既存アプリの動作確認、ブランチ作成、`socket.io` の追加、`/chat` と接続ログの確認

### 1. 目的
* 既存機能（TOP / TODO / AI質問 V1・V2）が作業開始時点で正常に動くことを確認し、作業用ブランチを作成する。
* `socket.io` をインストールし、既存の Express サーバーとポート競合を起こさない形で `/chat` の初期画面表示とクライアント接続ログを確認する。

### 2. 対応する REQ / DES
* `REQ-CHAT-001`（画面初期表示）、`REQ-CHAT-010`（既存機能の非破壊）
* `DES-CHAT-001`（モジュール分割と `index.ts` へのマウント順序）

### 3. 既存構成の確認結果（確定事項）
* **npm スクリプト:** 開発サーバー起動は `npm run dev`、TypeScript ビルドは `npm run build` を使用する。
* **DB接続モジュール:** プロジェクト直下の `db.ts`（`src/apps/chat/` からの相対パスは `../../../db`）から既存の `pool` を再利用する。
* **ポート待機箇所:** 既存 `index.ts` の末尾にある `app.listen(PORT, ...)` を `http.createServer(app)` へ置き換えて1箇所のみで待機する。

### 4. 変更・追加ファイル
* `package.json` / `package-lock.json`（`socket.io` 追加）
* `views/chat/index.ejs`（新規：最小骨格HTML）
* `public/chat/chat.js`（新規：接続確認JS）
* `src/apps/chat/chatRouter.ts`（新規：`/chat` 画面ルート）
* `index.ts`（編集：`http.Server` ＋ `Socket.IO` 初期化と `chatPageRouter` マウント）

### 5. 追加・変更する処理（最小例）

**① `views/chat/index.ejs`（新規作成・XSS対策のため `<%= ... %>` を使用）**
```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title><%= title %></title>
</head>
<body>
  <h1><%= title %></h1>
  <p id="status-text">接続確認中...</p>
  <script src="/socket.io/socket.io.js"></script>
  <script src="/chat/chat.js"></script>
</body>
</html>
```

**② `public/chat/chat.js`（新規作成・XSS対策のため `textContent` を使用）**
```javascript
document.addEventListener('DOMContentLoaded', () => {
  const statusEl = document.getElementById('status-text');
  if (statusEl) {
    statusEl.textContent = 'チャット画面の読み込み完了（疎通OK）';
  }

  // ローカルでの Socket.IO 疎通確認（Vercel環境等での失敗時はエラー握りつぶし）
  if (typeof io !== 'undefined') {
    const socket = io();
    socket.on('connect', () => {
      console.log('[Chat Socket] connected:', socket.id);
    });
  }
});
```

**③ `src/apps/chat/chatRouter.ts`（新規作成）**
```typescript
import { Router, Request, Response } from 'express';

export const chatPageRouter = Router();

chatPageRouter.get('/', (req: Request, res: Response) => {
  console.log(`[Chat Access] GET /chat at ${new Date().toISOString()}`);
  res.render('chat/index', { title: 'リアルタイムチャット' });
});
```

**④ `index.ts`（既存の `app.listen` を置き換えて二重待機を防止）**
```typescript
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { chatPageRouter } from './src/apps/chat/chatRouter';

// --- 既存の AI V2 APIルーティング登録の直後に追加 ---
app.use('/chat', chatPageRouter);

// --- 既存の app.listen(PORT, ...) を以下に置き換え（二重 listen 厳禁） ---
const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer);

io.on('connection', (socket) => {
  console.log(`[Socket.IO] client connected: ${socket.id}`);
  socket.on('disconnect', (reason) => {
    console.log(`[Socket.IO] client disconnected: ${socket.id} (${reason})`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});
```

### 6. コマンドと実行場所
プロジェクトルートディレクトリ（`package.json` と `db.ts` がある階層）のターミナルで実行する。

```bash
# 1. 既存アプリの起動確認
npm run dev

# 2. 別ターミナルで作業ブランチ作成
git status
git checkout -b feat/chat-app

# 3. socket.io のインストール
npm install socket.io
```

### 7. 確認操作と期待結果
1. ブラウザで `http://localhost:3000/`、`TODO`、`/ai`、`/ai/v2` を開き、既存機能がすべて正常に動作すること。
2. ブラウザで `http://localhost:3000/chat` を開き、画面に「リアルタイムチャット」「チャット画面の読み込み完了（疎通OK）」と表示されること。
3. サーバー側ターミナルに `[Chat Access] GET /chat at ...` と `[Socket.IO] client connected: ...` が出力されること。
4. ブラウザの開発者ツール（Console）に `[Chat Socket] connected: ...` が出力され、404エラーが出ていないこと。

### 8. つまずいたときの切り分け
* **`Error: listen EADDRINUSE: address already in use :::3000` が出る:**
  * 既存の `app.listen(PORT)` を消し忘れて `httpServer.listen(PORT)` と2重に呼んでいるか、別ターミナルでサーバーが起動したままになっている。`index.ts` 内で `.listen(` が1箇所だけであることを確認する。
* **`/chat` が 404 になる:**
  * `app.use('/chat', chatPageRouter)` が 404 ハンドラーより前に登録されているか確認する。

---

## 工程 B：検証用 Neon への SQL 適用、Model での投稿保存と最新20件取得

### 1. 目的
* 検証用 Neon DB（PostgreSQL）にチャット専用3テーブルを作成し、初期3ルーム（`Room 1`〜`Room 3`）を投入する。
* プロジェクト直下の `db.ts`（`pool`）を再利用し、パラメータ化 SQL によるメッセージ保存（1ルーム最大50件維持）と最新20件の昇順取得を実装する。

### 2. 対応する REQ / DES
* `REQ-CHAT-004`（DB保存・50件上限管理）、`REQ-CHAT-005`（最新20件取得）
* `DES-CHAT-003`（テーブル定義・インデックス・パラメータ化クエリ）

### 3. 変更・追加ファイル
* `sql/chat/040_create_chat_tables.sql`（新規：DDL＋初期ルーム投入）
* `src/apps/chat/chatModel.ts`（新規：DB操作層）

### 4. 追加・変更する処理（最小例）

**① `sql/chat/040_create_chat_tables.sql`（新規作成）**
```sql
CREATE TABLE IF NOT EXISTS chat_rooms (
  id INTEGER PRIMARY KEY,
  name VARCHAR(30) NOT NULL,
  max_capacity INTEGER NOT NULL DEFAULT 5
);

INSERT INTO chat_rooms (id, name, max_capacity)
VALUES (1, 'Room 1', 5), (2, 'Room 2', 5), (3, 'Room 3', 5)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS chat_seats (
  seat_token UUID PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES chat_rooms(id),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_seats_room_last_seen
  ON chat_seats (room_id, last_seen_at);

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGSERIAL PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES chat_rooms(id),
  user_name VARCHAR(20) NOT NULL,
  comment VARCHAR(500) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_room_id_desc
  ON chat_messages (room_id, id DESC);
```

**② `src/apps/chat/chatModel.ts`（新規作成・プロジェクト直下の `../../../db` から `pool` を再利用）**
```typescript
import { pool } from '../../../db';

export interface ChatMessageItem {
  id: number;
  roomId: number;
  userName: string;
  comment: string;
  createdAt: string;
}

export const chatModel = {
  // 最新20件を取得し、画面表示用に古い順（昇順）へ反転
  async findLatestMessages(roomId: number, limit: number = 20): Promise<ChatMessageItem[]> {
    const sql = `
      SELECT id, room_id, user_name, comment, created_at
      FROM chat_messages
      WHERE room_id = $1
      ORDER BY id DESC
      LIMIT $2;
    `;
    const result = await pool.query(sql, [roomId, limit]);
    return result.rows.reverse().map((row) => ({
      id: Number(row.id),
      roomId: Number(row.room_id),
      userName: row.user_name,
      comment: row.comment,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  },

  // メッセージ保存＋1ルーム50件超過分の削除（トランザクション）
  async saveMessageAndTrim(roomId: number, userName: string, comment: string): Promise<ChatMessageItem> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const insertSql = `
        INSERT INTO chat_messages (room_id, user_name, comment)
        VALUES ($1, $2, $3)
        RETURNING id, room_id, user_name, comment, created_at;
      `;
      const inserted = await client.query(insertSql, [roomId, userName, comment]);

      const trimSql = `
        DELETE FROM chat_messages
        WHERE room_id = $1
          AND id NOT IN (
            SELECT id FROM chat_messages
            WHERE room_id = $1
            ORDER BY id DESC
            LIMIT 50
          );
      `;
      await client.query(trimSql, [roomId]);
      await client.query('COMMIT');

      const row = inserted.rows[0];
      return {
        id: Number(row.id),
        roomId: Number(row.room_id),
        userName: row.user_name,
        comment: row.comment,
        createdAt: new Date(row.created_at).toISOString(),
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};
```

### 5. コマンドと実行場所
プロジェクトルート（または Neon ダッシュボードの SQL Editor）で実行する。

```bash
# 1. Neon コンソールの SQL Editor で sql/chat/040_create_chat_tables.sql の内容を実行
# （ローカルに psql がある場合は .env の DATABASE_URL または DATABASE_URL_POOLED で実行可）

# 2. TypeScript のコンパイル・型チェック
npx tsc --noEmit
```

### 6. 確認操作と期待結果
1. Neon コンソールの Tables 一覧で `chat_rooms`, `chat_seats`, `chat_messages` が作成され、`chat_rooms` に `Room 1`〜`Room 3` の3行が存在すること。
2. `npx tsc --noEmit` がエラー0件で終了すること。

### 7. つまずいたときの切り分け
* **`Cannot find module '../../../db'` が出る:** プロジェクト直下のファイル名が `db.ts` であることを確認し、`src/apps/chat/chatModel.ts` からの階層（`chat` → `apps` → `src` → ルートで `../../../db`）が合っているか確認する。
* **既存テーブルへの影響確認:** Neon 上の `todos`, `ai_conversations`, `ai_conversation_turns` が変更されていないことを確認する。

---

## 工程 C：投稿フォーム、サーバー検証、保存後の同一ルーム配信、2タブでの確認

### 1. 目的
* ユーザー名（前後空白除去後 1〜20文字・絵文字禁止）とコメント（前後空白除去後 1〜500文字・連続改行を `\n` 1つに自動正規化）のフォームとサーバー検証を実装する。
* 保存したメッセージを同一ルームの別タブへリアルタイム（1.5秒間隔ポーリング同期）で配信し、XSS エスケープ（`textContent`）が機能することを確認する。

### 2. 対応する REQ / DES
* `REQ-CHAT-002`（入力検証）, `REQ-CHAT-003`（同一ルーム配信）, `REQ-CHAT-009`（XSS対策）
* `DES-CHAT-002`（API仕様）, `DES-CHAT-004`（ID重複排除描画）, `DES-CHAT-006`（バリデーション）

### 3. 変更・追加ファイル
* `src/apps/chat/chatService.ts`（新規：検証・正規化・業務ロジック）
* `src/apps/chat/chatController.ts`（新規：HTTPリクエスト処理・統一JSON応答）
* `src/apps/chat/chatRouter.ts`（編集：`chatApiRouter` 追加）
* `views/chat/index.ejs`（編集：投稿フォームと履歴リストUI）
* `public/chat/chat.js`（編集：送信・ポーリング・`textContent` 描画）
* `index.ts`（編集：`app.use('/api/chat', chatApiRouter)` 追加）

### 4. 追加・変更する処理（最小例）

**① `src/apps/chat/chatService.ts`（検証・正規化ロジック抜粋）**
```typescript
export class ChatServiceError extends Error {
  constructor(
    public readonly message: string,
    public readonly statusCode: number = 400,
    public readonly code: string = 'VALIDATION_ERROR'
  ) {
    super(message);
  }
}

export function validateAndNormalizePost(rawUserName: unknown, rawComment: unknown) {
  if (typeof rawUserName !== 'string' || typeof rawComment !== 'string') {
    throw new ChatServiceError('ユーザー名とコメントは文字列で入力してください', 400, 'INVALID_INPUT');
  }

  const trimBoth = (s: string) => s.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
  const userName = trimBoth(rawUserName);

  const userNameLen = Array.from(userName).length;
  if (userNameLen < 1 || userNameLen > 20) {
    throw new ChatServiceError('ユーザー名は1文字以上20文字以内で入力してください');
  }
  if (/\p{Extended_Pictographic}/u.test(userName)) {
    throw new ChatServiceError('ユーザー名に絵文字は使用できません');
  }

  // 改行コードを \n に統一し、2回以上の連続改行を1回の改行(\n)へ自動変換
  const normalizedComment = trimBoth(rawComment.replace(/\r\n?/g, '\n')).replace(/\n{2,}/g, '\n');
  const commentLen = Array.from(normalizedComment).length;
  if (commentLen < 1 || commentLen > 500) {
    throw new ChatServiceError('コメントは1文字以上500文字以内で入力してください');
  }

  return { userName, comment: normalizedComment };
}
```

**② `public/chat/chat.js`（XSS安全な差分描画の最小例）**
```javascript
const renderedIds = new Set();

function appendMessage(msg) {
  if (renderedIds.has(msg.id)) return; // ID重複防止
  renderedIds.add(msg.id);

  const list = document.getElementById('message-list');
  const item = document.createElement('div');
  item.className = 'chat-item';

  const header = document.createElement('strong');
  header.textContent = `${msg.userName} (${new Date(msg.createdAt).toLocaleTimeString()})`;

  const body = document.createElement('p');
  body.style.whiteSpace = 'pre-wrap';
  body.textContent = msg.comment; // innerHTML 禁止・必ず textContent を使用

  item.appendChild(header);
  item.appendChild(body);
  list.appendChild(item);
}
```

### 5. コマンドと実行場所
```bash
# プロジェクトルートで開発サーバー起動
npm run dev
```

### 6. 確認操作と期待結果
1. ブラウザで `http://localhost:3000/chat` を **2つのタブ（タブA・タブB）** で開く。
2. タブAからユーザー名「学生A」、コメント「こんにちは」を送信すると、リロードなしでタブA・タブBの両方に表示されること。
3. ユーザー名に絵文字（`テスト😀`）や21文字以上を入力するとエラーメッセージが表示され送信できないこと。
4. コメントに空行（3行連続改行）を入れて送信すると、1回の改行に自動整形されて保存・表示されること。
5. コメントに `<script>alert('XSS')</script>` を送信してもアラートが実行されず、文字列そのまま画面に表示されること。

### 7. つまずいたときの切り分け
* **送信時に `413 Payload Too Large` になる:** `index.ts` で `express.json({ limit: '10kb' })` が設定されているため、リクエストボディに不要な巨大データを含めていないか確認する。
* **自分の投稿が2重に表示される:** `POST /api/chat/messages` の応答描画と `GET /api/chat/sync` の差分取得で同じ `msg.id` が返るため、`renderedIds.has(msg.id)` の重複ガードが機能しているか確認する。

---

## 工程 D：5人制限、切断時の席解放、再入室と履歴同期、画面への例外表示

### 1. 目的
* `chat_rooms` の行ロック（`FOR UPDATE`）による「1ルーム5名（全3室15名）」の定員制御と、`seatToken` による履歴閲覧認可を実装する。
* 16人目以降の「満席待機画面（閲覧・投稿不可＋3秒自動ポーリング）」と、タブ閉じ（`sendBeacon`）および 45秒タイムアウトによる席解放・自動再入室を完成させる。

### 2. 対応する REQ / DES
* `REQ-CHAT-005`（再接続最新20件）, `REQ-CHAT-006`（満席制限・自動待機）, `REQ-CHAT-007`（離脱検知・枠解放）, `REQ-CHAT-010`（例外表示）
* `DES-CHAT-002`（`seatToken` 認可）, `DES-CHAT-004`（状態遷移・タイマー多重防止）, `DES-CHAT-005`（行ロック・45秒回収）

### 3. 変更・追加ファイル
* `src/apps/chat/chatModel.ts`（編集：`joinRoomWithLock`, `syncAndHeartbeat`, `leaveSeat` 追加）
* `src/apps/chat/chatService.ts` / `chatController.ts`（編集：`401 SEAT_EXPIRED` 制御追加）
* `views/chat/index.ejs`（編集：満席待機エリア・エラーバナーの追加）
* `public/chat/chat.js`（編集：満席ポーリング、単一 `setTimeout` 管理、`pagehide` 離脱通知、`401` 自動再入室）

### 4. 追加・変更する処理（最小例）

**① `src/apps/chat/chatModel.ts`（行ロック付き席確保の核心部）**
```typescript
import crypto from 'crypto';

// joinRoomWithLock 内のトランザクション処理抜粋
await client.query('BEGIN');
// 1. 全3ルームを行ロックして同時アクセスを直列化
const roomsRes = await client.query(
  'SELECT id, name, max_capacity FROM chat_rooms ORDER BY id ASC FOR UPDATE;'
);
// 2. 45秒以上通信がない死んだ席を回収
await client.query(
  "DELETE FROM chat_seats WHERE last_seen_at < NOW() - INTERVAL '45 seconds';"
);
// 3. ルーム別有効席数を集計
const countsRes = await client.query(
  'SELECT room_id, COUNT(*)::int AS cnt FROM chat_seats GROUP BY room_id;'
);
const countMap = new Map<number, number>(
  countsRes.rows.map((r) => [Number(r.room_id), Number(r.cnt)])
);

// 4. 空きがある最初のルームへ席を割り当て
const availableRoom = roomsRes.rows.find(
  (r) => (countMap.get(Number(r.id)) ?? 0) < Number(r.max_capacity)
);
if (!availableRoom) {
  await client.query('COMMIT');
  return { joined: false as const };
}

const seatToken = crypto.randomUUID();
await client.query(
  'INSERT INTO chat_seats (seat_token, room_id, last_seen_at) VALUES ($1, $2, NOW());',
  [seatToken, availableRoom.id]
);
await client.query('COMMIT');
```

**② `public/chat/chat.js`（多重タイマー防止と離脱送信の例）**
```javascript
let pollingTimer = null;

function scheduleNext(fn, delayMs) {
  if (pollingTimer) clearTimeout(pollingTimer);
  pollingTimer = setTimeout(fn, delayMs);
}

// 初期化時に1回だけ登録（再入室時に重複登録しない）
window.addEventListener('pagehide', () => {
  if (seatToken) {
    navigator.sendBeacon(`/api/chat/leave?token=${encodeURIComponent(seatToken)}`);
  }
});
```

### 5. コマンドと実行場所
```bash
npm run dev
```

### 6. 確認操作と期待結果
1. ブラウザでタブを 1〜5個目まで開くとすべて `Room 1`（`5 / 5 人`）になり、6〜10個目が `Room 2`、11〜15個目が `Room 3` に自動割り当てられること。
2. **16個目のタブ**を開くと「現在満席です（空きが出次第自動で入室します）」という待機画面になり、チャット履歴や送信フォームが表示されないこと。
3. 1〜15個目のタブのうち1つを閉じると、3秒以内に16個目のタブが自動的に入室状態へ切り替わり、最新20件が表示されること。
4. ブラウザの DevTools（Network → Offline）で一時切断して 50秒後に Online へ戻すと、自動的に再入室して履歴が同期されること。

### 7. つまずいたときの切り分け
* **タブを閉じても人数が減らない:** `POST /api/chat/leave` が `sendBeacon` 経由のクエリパラメータ（`req.query.token`）またはヘッダの両方を受け取れるようコントローラー側で対応しているか確認する。
* **再入室後にリクエストが多重化する:** `scheduleNext` の前に `clearTimeout(pollingTimer)` が呼ばれているか、または `setInterval` を使ってしまっていないか確認する。

---

## 工程 E：複数インスタンス向け同期と共有定員管理、異なる2台での確認、既存機能の回帰確認

### 1. 目的
* サーバーが複数インスタンス（ローカルでの別ポート2プロセス、および Vercel 本番デプロイ環境）で稼働する状態において、メッセージ同期と「全台合計で1ルーム5名（計15名）」の制約が破られないことを実証する。
* 既存機能（TOP / TODO / AI質問 V1・V2 / 404 / エラー処理）に回帰バグがないことを最終確認する。

### 2. 対応する REQ / DES
* `REQ-CHAT-008`（複数インスタンス同期・定員厳守）, `REQ-CHAT-010`（既存機能の回帰保証）
* `DES-CHAT-005`（複数台検証）, `DES-CHAT-006`（秘密情報・例外処理）

### 3. 変更・追加ファイル
* コード変更は原則なし。
* 本番デプロイ前に、Neon の本番用 DB に対しても `sql/chat/040_create_chat_tables.sql` を適用する。

### 4. コマンドと実行場所

**① ローカルでの擬似2台（マルチポート）起動確認**
同じ `.env`（同じ Neon DB）を参照しつつ、2つのターミナルでポートを変えて起動する。
```bash
# ターミナル1（インスタンスA：ポート3001）
PORT=3001 npm run dev

# ターミナル2（インスタンスB：ポート3002）
PORT=3002 npm run dev
```

**② ビルド・本番（Vercel）デプロイ前チェック**
```bash
# TypeScript 本番ビルド確認
npm run build

# 秘密情報（.env）が含まれていないか確認してプッシュ
git status
git add .
git commit -m "feat: リアルタイムチャット機能(/chat)を追加"
git push origin feat/chat-app
```

### 5. 確認操作と期待結果
1. **ローカル2プロセス間同期:** ブラウザ1で `http://localhost:3001/chat`、ブラウザ2で `http://localhost:3002/chat` を開き、3001側から投稿したメッセージが 2秒以内に 3002側へ表示されること。
2. **同時入室時の定員厳守:** 残り1枠（14/15人）の状態で、3001側と3002側から同時に `/chat` を開いた際、**片方のみが入室成功（15/15人）となり、もう片方が満席待機画面になること**。
3. **片系停止リカバリ:** ターミナル1（3001）を `Ctrl+C` で強制終了した後、45秒経過すると 3002側から新規タブで空き枠へ入室できること。
4. **Vercel 本番・2端末確認:** Vercel デプロイ後の本番 URL（`https://<your-app>.vercel.app/chat`）に PC とスマートフォン等、異なる2台以上の端末からアクセスし、リアルタイム会話と5人制限が動作すること。
5. **既存機能の回帰確認:** TOP（`/`）、TODO、AI質問（`/ai`, `/ai/v2`）、404（`/not-found-test`）がすべて正常に動作し、ブラウザ側に `DATABASE_URL` や `GEMINI_API_KEY` が露出していないこと。

### 6. つまずいたときの切り分け
* **Vercel 上で `500 INTERNAL_ERROR` になる:**
  1. 本番用 Neon DB に `sql/chat/040_create_chat_tables.sql` が実行済みか確認する。
  2. Vercel の Environment Variables に `DATABASE_URL`（または `DATABASE_URL_POOLED`）が設定されているか確認する。
  3. Vercel ダッシュボードの「Logs」タブで `[Chat Error]:` の出力内容を確認する。