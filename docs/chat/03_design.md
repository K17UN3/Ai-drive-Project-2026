# チャット機能 詳細設計書（Vercel・既存アーキテクチャ準拠版）

* **文書ファイル:** `docs/chat/03_design.md`
* **ステータス:** 確定版（Vercel環境・既存コード反映済み）
* **対象システム:** 既存Webアプリケーション（Express / TypeScript / EJS / Neon PostgreSQL / Vercel）

---

## 0. 本設計における技術方針（Vercel サーバーレス対応）

本アプリケーションは **Vercel** 上で稼働するため、リクエスト単位で実行ライフサイクルが完結するサーバーレス環境に最適化したアーキテクチャを採用する。

* **通信方式の確定:** Vercel サーバーレス関数では長時間維持される WebSocket（Socket.IO）の持続接続が維持できないため、**HTTP REST API ＋ 短い間隔の差分ポーリング（1.5〜2秒間隔）** を採用する。これにより、サーバー側にインメモリ状態を持たず、複数インスタンス（並列起動するサーバーレス関数）間で完全に整合したリアルタイム配信と定員制御を実現する。
* **既存コード規約の踏襲:** `index.ts` および `src/apps/ai/v2/` の設計パターン（`export const xxxController = { ... }` 形式、統一 JSON レスポンス `{ status, code, message, data }`、10KB ボディ制限）に完全に準拠する。

---

## 1. 設計項目と要件の対応表（DES-CHAT-xxx / REQ-CHAT-xxx）

| 設計ID | 対応要件ID | 設計対象領域 | 概要 |
| :--- | :--- | :--- | :--- |
| **DES-CHAT-001** | REQ-CHAT-001, 010 | モジュール分割とルーティング | `src/apps/chat/` の責務分離と `index.ts` へのマウント順序、既存ルート（TOP/TODO/AI）への非干渉設計 |
| **DES-CHAT-002** | REQ-CHAT-001, 003, 005, 006 | HTTP API インターフェース設計 | `/chat` 画面および `/api/chat/*`（入室・差分取得兼Heartbeat・投稿・退室）の仕様と `seatToken` 認可 |
| **DES-CHAT-003** | REQ-CHAT-003, 004, 005, 008 | データベース設計（Neon PostgreSQL） | `chat_rooms` / `chat_seats` / `chat_messages` のスキーマ、行ロック排他制御、50件上限維持と最新20件昇順取得 |
| **DES-CHAT-004** | REQ-CHAT-001, 003, 005, 006 | クライアント制御・状態遷移シーケンス | 入室→最新20件描画→ポーリング同期（ID重複排除）→投稿→満席待機ポーリングのフロントエンド設計 |
| **DES-CHAT-005** | REQ-CHAT-006, 007, 008 | 複数インスタンス定員管理（1室5名×3室） | Vercel 並列実行環境下でのDB行ロックによる席確保、Heartbeatタイムアウト（45秒）による自動席回収 |
| **DES-CHAT-006** | REQ-CHAT-002, 009, 010 | 入力検証・セキュリティ・例外処理 | 絵文字禁止・連続改行の `\n` 正規化、XSSエスケープ、環境変数管理、統一エラーハンドリング |

---

## 2. アーキテクチャ・モジュール責務とルーティング（DES-CHAT-001）

### 2.1 ファイル構成と責務分担（既存 `ai/v2` パターン準拠）

| 区分 | ファイルパス | 責務 |
| :--- | :--- | :--- |
| **ルーター** | `src/apps/chat/chatRouter.ts` | 画面ルート（`GET /`）と API ルート（`POST /join`, `GET /sync`, `POST /messages`, `POST /leave`）の定義。 |
| **コントローラー** | `src/apps/chat/chatController.ts` | リクエスト型検証・サニタイズ（トリム・連続改行の `\n` 正規化・絵文字チェック）、`x-seat-token` ヘッダ抽出、統一JSONレスポンス返却。 |
| **サービス** | `src/apps/chat/chatService.ts` | 入室時の空きルーム探索・席トークン発行、メッセージ投稿と50件超過分の削除調整、業務エラー（`ChatServiceError`）の送出。 |
| **モデル** | `src/apps/chat/chatModel.ts` | Neon PostgreSQL（`pool`）へのSQL発行。行ロック（`FOR UPDATE`）を用いた席確保・Heartbeat更新・メッセージ保存・最新20件取得。 |
| **ビュー** | `views/chat/index.ejs` | チャット画面および満席待機画面の初期HTML構造（EJSテンプレート）。 |
| **ブラウザJS** | `public/chat/chat.js` | 画面状態管理（入室中 / 満席待機中 / エラー）、1.5秒間隔ポーリング（同期＋Heartbeat）、IDベースの差分描画（XSS安全描画）、`pagehide` 時の離脱通知。 |
| **DB定義SQL** | `sql/chat/040_create_chat_tables.sql` | `chat_rooms`（初期3ルーム投入含む）、`chat_seats`、`chat_messages` テーブルおよびインデックス作成。 |
| **アプリ統合** | `index.ts` | `chatPageRouter` と `chatApiRouter` のマウント（既存の `app.listen` および Vercel エクスポート構成を維持）。 |

### 2.2 実URL・ミドルウェア登録順と既存ルートへの影響

`index.ts` の既存記述を崩さず、末尾のルーティング定義セクションにチャット用ルーターを追加する。

1. `app.use(express.json({ limit: '10kb' }))`（既存：チャット投稿も 500文字＋ユーザー名20文字のため 10KB 上限内で十分動作）
2. `app.use(express.static(path.join(__dirname, 'public')))`（既存：`/chat/chat.js`, `/chat/chat.css` を配信）
3. `app.get('/', ...)` / `app.get('/api/db-check', ...)`（既存維持）
4. `app.get('/ai', ...)` / `app.get(['/ai/v2', '/ai/v2/'], ...)`（既存維持）
5. `app.use('/', todoRouter)`（既存維持：`todoRouter` 内に `/chat` や `/api/chat` と競合するパスが存在しない前提）
6. `app.use('/ai', aiRouter)` / `app.use('/api/ai', aiRouter)` / `app.use('/api/ai/v2', aiV2Router)`（既存維持）
7. **【新規追加】** `app.use('/chat', chatPageRouter)` → 実URL: `GET /chat`（`views/chat/index.ejs` をレンダリング）
8. **【新規追加】** `app.use('/api/chat', chatApiRouter)` → 実URL: `POST /api/chat/join` 等
9. 既存の 404・共通エラーハンドラー（定義されている場合は最下部に維持）

* **404・共通エラー処理への影響:** `/chat` および `/api/chat/*` 以外のパスは従来通り通過するため、TOP・TODO・AI・404処理への影響はゼロとなる。API エラーは `aiV2Controller.ts` と同様にコントローラー内の `try-catch` で捕捉し、統一された JSON フォーマットで返却する。

---

## 3. HTTP API インターフェース設計（DES-CHAT-002）

### 3.1 「画面表示」と「ルーム参加（席確保）」の分離
* `GET /chat` は HTML（EJS）を返すのみで席を確保しない。
* ブラウザで `chat.js` が起動した直後に `POST /api/chat/join` を呼び出すことで、初めて「ルームへの参加（席の確保）」が行われる。これにより、クローラーやプリフェッチによる無駄な席占有を防ぐ。

### 3.2 エンドポイント一覧

| メソッド | パス | 認可（検証） | リクエスト | 成功応答（HTTP Status / JSON） | 主なエラー応答 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **GET** | `/chat` | なし（公開） | なし | `200 OK` (`text/html`: `views/chat/index.ejs`) | `500`（テンプレート描画失敗） |
| **POST** | `/api/chat/join` | なし（空き枠判定） | `{}`（空ボディ可） | **空きあり (`200 OK`):**<br>`{ status: 'success', data: { joined: true, roomId: 1, roomName: 'Room 1', seatToken: 'uuid', activeCount: 3, maxCapacity: 5, messages: [...] } }`<br>**全3室満席 (`200 OK`):**<br>`{ status: 'success', data: { joined: false, retryAfterMs: 3000 } }` | `500 INTERNAL_ERROR`（DB障害） |
| **GET** | `/api/chat/sync` | **必須:**<br>`x-seat-token` ヘッダ | Query:<br>`afterId=<number>`<br>（初回は `0`） | `200 OK`:<br>`{ status: 'success', data: { roomId: 1, roomName: 'Room 1', activeCount: 4, messages: [...] } }` | `401 SEAT_EXPIRED`（席失効・未参加）<br>`400 INVALID_INPUT`<br>`500 INTERNAL_ERROR` |
| **POST** | `/api/chat/messages` | **必須:**<br>`x-seat-token` ヘッダ | Body:<br>`{ userName: string, comment: string }` | `201 Created`:<br>`{ status: 'success', data: { message: { id, roomId, userName, comment, createdAt } } }` | `400 VALIDATION_ERROR`<br>`401 SEAT_EXPIRED`<br>`500 INTERNAL_ERROR` |
| **POST** | `/api/chat/leave` | **必須:**<br>`x-seat-token` ヘッダ（またはクエリ） | `navigator.sendBeacon` 用（空ボディ） | `200 OK`: `{ status: 'success' }` | `200 OK`（冪等に処理しエラーにしない） |

### 3.3 履歴閲覧の参加資格検証（`seatToken` 認可）
* 満席待機中のユーザー（16人目以降）が直接 API をリクエストして会話内容を閲覧することを防ぐため、`POST /api/chat/join` 成功時にサーバー側で暗号学的に安全なランダム文字列（`crypto.randomUUID()`）を `seatToken` として発行し、`chat_seats` テーブルに保存する。
* `GET /api/chat/sync`（差分履歴取得）および `POST /api/chat/messages`（投稿）は、HTTP ヘッダ `x-seat-token` に含まれるトークンが `chat_seats` 上に有効（タイムアウト期限内）なレコードとして存在する場合のみ処理を許可する。
* トークンが未指定、存在しない、またはタイムアウトにより回収済みの場合は `401 Unauthorized`（`code: 'SEAT_EXPIRED'`）を返し、メッセージ配列は一切返却しない。

---

## 4. データベース設計（DES-CHAT-003）

既存 Neon DB（PostgreSQL）上に、既存テーブルと独立した3つのテーブルを作成する。

### 4.1 テーブル定義（`sql/chat/040_create_chat_tables.sql`）

#### 1. `chat_rooms`（ルームマスター：固定3レコード）
| 列名 | 型 | 制約 | 説明 |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY` | ルームID（`1`, `2`, `3` 固定） |
| `name` | `VARCHAR(30)` | `NOT NULL` | 表示名（`Room 1`, `Room 2`, `Room 3`） |
| `max_capacity` | `INTEGER` | `NOT NULL DEFAULT 5` | 定員（`5` 固定） |

※ 初期データとして `id = 1, 2, 3` の3行を `INSERT ... ON CONFLICT DO NOTHING` で投入する。この行が**席確保時の行ロック対象**となる。

#### 2. `chat_seats`（アクティブ参加席管理）
| 列名 | 型 | 制約 | 説明 |
| :--- | :--- | :--- | :--- |
| `seat_token` | `UUID` | `PRIMARY KEY` | クライアントへ発行する一意な参加トークン |
| `room_id` | `INTEGER` | `NOT NULL REFERENCES chat_rooms(id)` | 所属ルームID（`1`〜`3`） |
| `last_seen_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | 最終Heartbeat（`join` または `sync`）受信時刻 |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | 入室時刻 |

* **インデックス:** `CREATE INDEX idx_chat_seats_room_last_seen ON chat_seats (room_id, last_seen_at);`

#### 3. `chat_messages`（チャットメッセージ履歴：1ルーム最大50件）
| 列名 | 型 | 制約 | 説明 |
| :--- | :--- | :--- | :--- |
| `id` | `BIGSERIAL` | `PRIMARY KEY` | 連番メッセージID（差分取得・並び順の基準） |
| `room_id` | `INTEGER` | `NOT NULL REFERENCES chat_rooms(id)` | 投稿先ルームID |
| `user_name` | `VARCHAR(20)` | `NOT NULL` | ユーザー名（絵文字なし・トリム済1〜20文字） |
| `comment` | `VARCHAR(500)` | `NOT NULL` | コメント本文（連続改行正規化済・トリム済1〜500文字） |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | 投稿日時 |

* **インデックス:** `CREATE INDEX idx_chat_messages_room_id_desc ON chat_messages (room_id, id DESC);`

### 4.2 クエリ方針（パラメータ化・最新20件昇順・50件上限維持）
すべての SQL は `pool.query(sql, params)` のプレースホルダ（`$1, $2...`）を使用し、SQLインジェクションを完全に防止する。

* **最新20件の取得と古い順（昇順）表示:**
  * `aiV2Model.ts` の `findTurnsForDisplay` と同じ設計を採用する。
  * SQL で `SELECT id, room_id, user_name, comment, created_at FROM chat_messages WHERE room_id = $1 ORDER BY id DESC LIMIT 20` を実行して最新20件を抽出し、アプリケーション層（Model）で `.reverse()` して時系列昇順（古い→新しい）で返す。
  * ポーリング時（`afterId > 0`）は `WHERE room_id = $1 AND id > $2 ORDER BY id ASC LIMIT 50` で差分のみを取得する。
* **保存と1ルーム最大50件の維持（トランザクション内実行）:**
  1. `INSERT INTO chat_messages (room_id, user_name, comment) VALUES ($1, $2, $3) RETURNING ...` で新規メッセージを保存する。
  2. 直後に同トランザクション内で以下の削除クエリを実行し、該当ルームの最新50件より古いレコードを物理削除する。
     ```sql
     DELETE FROM chat_messages
     WHERE room_id = $1
       AND id NOT IN (
         SELECT id FROM chat_messages
         WHERE room_id = $1
         ORDER BY id DESC
         LIMIT 50
       );
     ```

---

## 5. 処理シーケンスとフロントエンド状態管理（DES-CHAT-004）

### 5.1 全体の処理順序
1. **初期表示（`GET /chat`）:** ブラウザが HTML と `chat.js` を読み込む（初期状態は「接続中...」スピナー表示）。
2. **入室試行（`POST /api/chat/join`）:**
   * **満席時（`joined: false`）:** 「満席待機画面」を表示（入力フォーム・メッセージ欄は非表示）。`setTimeout` で 3秒後に再度 `POST /api/chat/join` を実行する待機ループに入る。
   * **入室成功時（`joined: true`）:** `seatToken` と `roomId` をメモリ変数に保持し、レスポンスに含まれる最新20件（`messages`）を描画。最後のメッセージの `id` を `lastMessageId` に記録し、チャット画面を表示する。
3. **定期同期・Heartbeat（`GET /api/chat/sync?afterId={lastMessageId}`）:**
   * 入室成功後、**1.5秒間隔**のポーリングループ（完了後に次のタイマーをセットする直列 `setTimeout` 方式）を開始する。
   * サーバー側はこのリクエストを受けるたびに `chat_seats.last_seen_at = NOW()` を更新（Heartbeat兼任）し、`afterId` より大きい `id` の新規メッセージと最新の参加人数を返す。
4. **投稿処理（`POST /api/chat/messages`）:**
   * クライアント側バリデーション後、ボタンを二重送信防止のため無効化し API 送信。
   * 成功レスポンスで返却された自メッセージ（`data.message`）を画面へ反映し、入力欄のうちコメントのみクリア（ユーザー名は保持）する。
5. **切断・離脱（`pagehide` / `beforeunload`）:**
   * タブ閉じ・画面遷移時に `navigator.sendBeacon('/api/chat/leave?token=...')`（または `keepalive: true` の `fetch`）を送信し、即座にDB上の席を解放する。
6. **席失効（`401 SEAT_EXPIRED`）からの自動再入室:**
   * PCスリープや一時的な通信断で45秒以上ポーリングが途絶え、`sync` や `messages` で `401` が返った場合、ポーリングを停止して状態をリセットし、自動的に手順2（`POST /api/chat/join`）へ戻って再入室（最新20件の再取得）を試みる。

### 5.2 重複排除とタイマー／リスナー多重登録の防止
* **IDベースの重複排除（履歴取得・投稿・ポーリングの競合対策）:**
  * クライアント側に `renderedMessageIds = new Set<number>()` を保持する。
  * 初期20件描画時、自分の投稿成功レスポンス受信時、ポーリング差分受信時のいずれにおいても、描画関数内で `if (renderedMessageIds.has(msg.id)) return;` をチェックしてから DOM に追加する。これにより、投稿直後のレスポンスとポーリング取得が交差してもメッセージが二重表示されない。
  * 再入室（リセット）時は `renderedMessageIds.clear()` とメッセージ一覧 DOM のクリアを同時に行う。
* **イベントリスナー・タイマーの肥大化防止:**
  * DOM イベントリスナー（送信フォームの `submit`、`pagehide` 等）はページ初期化時に**1回だけ**登録し、再入室や状態切り替え時には再登録しない。
  * ポーリングは `setInterval` ではなく、リクエスト完了後に次のタイマーを予約する単一の `pollingTimerId` 管理（新規開始前に必ず `clearTimeout(pollingTimerId)` を実行）とし、ネットワーク遅延や再入室時にリクエストが多重化することを防ぐ。

---

## 6. 複数インスタンス定員管理・障害設計（DES-CHAT-005）

### 6.1 Vercel（複数インスタンス）における排他制御と席回収
Vercel ではリクエストごとに異なるサーバーレスインスタンスが並列起動するため、インメモリ変数は共有されない。すべての状態判定を Neon PostgreSQL のトランザクション内で行う。

* **全インスタンス合計で「1ルーム5名（計15名）」を守る仕組み:**
  1. `POST /api/chat/join` の処理開始時、DBトランザクション（`BEGIN`）を開始する。
  2. `SELECT id, name, max_capacity FROM chat_rooms ORDER BY id ASC FOR UPDATE;` を実行し、全3ルームの行ロックを取得する（これにより、他のインスタンスからの同時入室リクエストはロック解放まで直列に待機する）。
  3. 期限切れの古い席レコードを削除する（席回収）：
     `DELETE FROM chat_seats WHERE last_seen_at < NOW() - INTERVAL '45 seconds';`
  4. ルームごとの現在の有効参加数を集計する：
     `SELECT room_id, COUNT(*)::int AS cnt FROM chat_seats GROUP BY room_id;`
  5. `room_id = 1, 2, 3` の順に `cnt < 5` である最初のルームを選択する。
     * 空きがある場合：`chat_seats` に新規レコード（`seat_token`, `room_id`, `last_seen_at = NOW()`）を `INSERT` し、`COMMIT` する。
     * 全ルーム `cnt >= 5` の場合：何も挿入せず `COMMIT` し、`joined: false`（満席）を返す。
* **異常終了時の席回収（タイムアウト 45秒）:**
  * ブラウザの強制終了やネットワーク断で `leave` が届かなかった場合でも、クライアントからの `sync` ポーリング（1.5秒ごと）が止まることで `last_seen_at` の更新が停止する。
  * 最後の通信から **45秒**（要件定義の30秒〜1分の範囲内）経過すると、次回以降の `join` または `sync` 時のクリーンアップ条件により自動的に無効化・削除され、待機中のユーザーへ枠が解放される。
* **DB障害時の扱い:**
  * トランザクション内で例外が発生した場合は必ず `ROLLBACK` して `client.release()` を実行し、HTTP `500` を返却する。クライアントはポーリング間隔を一時的に延長（バックオフ：5秒間隔）し、画面上に「サーバーと通信できません。再試行しています...」と表示して復旧を待つ。

### 6.2 複数インスタンス環境での検証方法
1. **ローカルマルチポート検証:** 同一の `.env`（同じ Neon DB）を参照する状態で、ポートを変えて2プロセス（`PORT=3001` と `PORT=3002`）起動し、一方のブラウザで `http://localhost:3001/chat`、もう一方で `http://localhost:3002/chat` を開く。
2. **本番 Vercel 環境検証:** Vercel 上にデプロイされた同一 URL に対し、PCブラウザ複数タブ・スマートフォン等から計16接続を同時に行い、1〜15接続目が `Room 1〜3` に5名ずつ収まり、16接続目が満席待機画面になること、および異なるルーム参加者間で2秒以内にメッセージが同期されることを確認する。

---

## 7. 入力検証・セキュリティ・例外ハンドリング（DES-CHAT-006）

### 7.1 入力検証と正規化ルール（クライアント・サーバー共通仕様）
1. **型チェック（サーバー側）:** `typeof req.body?.userName === 'string'` および `typeof req.body?.comment === 'string'` を検証。文字列以外は `400 INVALID_INPUT` を返却。
2. **前後空白除去:** 両端の半角・全角スペース・改行・タブを除去（`str.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '')`）。
3. **ユーザー名検証:**
   * コードポイント長（`Array.from(userName).length`）が `1` 以上 `20` 以下であること。
   * **絵文字禁止:** Unicode プロパティエスケープ（`/\p{Extended_Pictographic}/u`）にマッチする文字が含まれる場合はエラーとする。
4. **コメント正規化および検証:**
   * 改行コード（`\r\n`, `\r`）を `\n` に統一したうえで、**2回以上連続する改行（`\n{2,}`）を自動的に1回の改行（`\n`）へ正規化**する（クライアント側の送信前プレビュー・送信データおよびサーバー側の受信処理の双方で実施）。
   * 正規化後のコードポイント長が `1` 以上 `500` 以下であること。

### 7.2 XSS 対策と秘密情報管理
* **XSS 対策:** `public/chat/chat.js` においてメッセージ要素を組み立てる際、`innerHTML` は一切使用せず、`document.createElement` と `element.textContent = msg.comment` のみを使用する。EJS テンプレート内も `<%= ... %>`（エスケープ出力）のみを使用する。
* **秘密情報管理:** Neon DB 接続文字列（`DATABASE_URL` / `DATABASE_URL_POOLED`）はサーバー側の環境変数のみから参照し、EJS のテンプレート変数や `/api/chat/*` のレスポンス JSON には一切含めない。

### 7.3 例外ハンドリングとログ出力
* コントローラー層は `aiV2Controller.ts` の設計に倣い、すべての非同期処理を `try-catch` で囲む。
* 業務上の予期されたエラー（バリデーション違反・席失効）はカスタムエラークラス `ChatServiceError`（`statusCode`, `code`, `message`）として捕捉し、適切な HTTP ステータス（`400` / `401`）と日本語メッセージを JSON で返す。
* 想定外のDBエラー等は `console.error('[Chat Error]:', err)` でサーバーログへ詳細（スタックトレース等）を記録したうえで、クライアントには内部構造を漏らさない汎用エラー JSON（`500 INTERNAL_ERROR`）を返却する。

---

## 8. 前提条件・未確定事項の整理

* **前提条件（確定済み）:**
  * ホスティング基盤は **Vercel** であり、WebSocket（Socket.IO）ではなく HTTP ポーリング（1.5秒間隔）でリアルタイム同期と死活監視を行う。
  * データベースは既存の **Neon（PostgreSQL）** を使用し、`src/db.ts`（`pool`）を経由して接続する（`DATABASE_URL` / `DATABASE_URL_POOLED` いずれでもトランザクションおよび行ロックが動作する前提）。
  * ルーム数は固定3室（`Room 1`〜`Room 3`）、各室定員5名（全体最大15名）、DB保持は1室最大50件、画面初期表示は最新20件とする。
  * コメントの連続改行は自動的に `\n` 1つへ正規化し、ユーザー名の絵文字は Unicode Emoji（`Extended_Pictographic`）を対象として禁止する。
* **実装フェーズでの確認事項（軽微）:**
  * `src/db.ts` の正確な相対パスおよびエクスポート名（`aiV2Model.ts` と同じ `pool` で問題ないか、実装時にファイル構成を確認して合わせる）。
  * 既存の `views/` 配下の共通ヘッダー・CSS（Tailwind や共通スタイルシートの有無）を `views/chat/index.ejs` に適用するかどうか（既存のデザインテイストに合わせて調整可能）。