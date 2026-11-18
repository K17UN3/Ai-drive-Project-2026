# AI質問アプリV2 実装手順書
## 1. 本手順書の目的と進め方

本ドキュメントは、採用済みの要件定義書（`docs/ai/v2/requirements.md`）および設計書（`docs/ai/v2/design.md`）に基づき、**AI質問アプリV2（マルチターン対話・会話スレッド管理機能）**を段階的に実装・検証するための実行手順書である。

### 進め方の原則
1. **段階的実装と検証**: `TASK-V2-01` から順番に実行し、各タスクの「次へ進む条件」を満たしてから次の工程へ進むこと。
2. **V1および既存機能の保護**: 既存のTOP（`/`）、TODO（`/todo`）、V1 AI画面（`/ai`）・API（`/api/ai/*`）・テーブル（`ai_qa_logs`）は変更・破壊しないこと。
3. **文脈制御の徹底**: 会話ID（`conversation_id`）によるスコープ分離を、UI・API・SQL・Gemini送信配列（`contents`）のすべてで担保すること。
4. **エビデンスの記録**: テスト項目表の「実測結果」「判定」欄は、学生自身が動作確認を行った後に記録すること。

---

## 2. 全体作業フロー（タスク一覧）

| 作業ID | 作業名称 | 主な対象 | 対応REQ・DES |
| :--- | :--- | :--- | :--- |
| **TASK-V2-01** | V1の疎通確認と作業ブランチ作成 | Git環境 / V1画面・API | `REQ-V2-08`, `DES-V2-01` |
| **TASK-V2-02** | V2専用DBテーブルの作成（Neon PostgreSQL） | `sql/ai/040_create_ai_v2_tables.sql` | `REQ-V2-02`, `REQ-V2-05`, `DES-V2-03` |
| **TASK-V2-03** | 会話作成・一覧・履歴取得APIの実装 | `src/apps/ai/v2/*`, `index.ts` | `REQ-V2-03`, `REQ-V2-04`, `REQ-V2-09`, `DES-V2-02`, `DES-V2-04` |
| **TASK-V2-04** | 文脈付き質問送信と1往復保存APIの実装 | `aiV2Service.ts`, `aiV2Model.ts`, `aiV2Controller.ts` | `REQ-V2-01`, `REQ-V2-02`, `REQ-V2-07`, `REQ-V2-10`, `DES-V2-04`, `DES-V2-05` |
| **TASK-V2-05** | V2画面UIと非同期クライアントの実装 | `public/ai/v2/index.html`, `public/ai/v2/app.js`, `index.ts` | `REQ-V2-03`〜`REQ-V2-07`, `DES-V2-06`, `DES-V2-07` |
| **TASK-V2-06** | 結合テスト・異常系テスト・回帰テストと提出準備 | 全機能 / テスト記録表 | `REQ-V2-01`〜`REQ-V2-10`, `DES-V2-01`〜`DES-V2-07` |

---

## 3. 各タスクの詳細手順

### TASK-V2-01: V1の疎通確認と作業ブランチ作成
* **対応REQ・DES**: `REQ-V2-08`（V1および既存機能への非干渉）, `DES-V2-01`（基本方針）
* **確認先・変更対象**:
  * Git 作業ブランチ（新規作成）
  * V1既存エンドポイント（`GET /`, `GET /todo`, `GET /ai`, `GET /api/ai/history`, `POST /api/ai/ask`）
* **具体的な操作**:
  1. ターミナルで現在の作業ツリーがクリーンであることを確認し、V2用の作業ブランチを作成・チェックアウトする。
     ```bash
     git status
     git checkout -b feat/ai-v2
     ```
  2. `.env` ファイルに有効な `GEMINI_API_KEY` と Neon PostgreSQL 接続情報（`DATABASE_URL` 等 ※要確認-01：環境変数名は `db.ts` の実装に合わせる）が設定されていることを確認する。
  3. 開発サーバーを起動する。
     ```bash
     npm run dev
     ```
  4. ブラウザまたは DevTools コンソールで以下にアクセスし、V1が正常稼働していることを確認する。
     * `http://localhost:3000/`（TOPページ表示）
     * `http://localhost:3000/todo`（TODOアプリ表示・操作）
     * `http://localhost:3000/ai`（V1 AI質問画面の表示・単発質問送信・履歴表示）
* **期待する結果**:
  * `feat/ai-v2` ブランチに切り替わっていること。
  * V1のすべての画面およびAPIがエラーなく正常動作すること。
* **次へ進む条件**: V1の正常動作が確認でき、V2用の作業ブランチ上で作業を開始できること。

---

### TASK-V2-02: V2専用DBテーブルの作成（Neon PostgreSQL）
* **対応REQ・DES**: `REQ-V2-02`, `REQ-V2-05`, `DES-V2-03`（データベース設計）
* **変更ファイル**:
  * `sql/ai/040_create_ai_v2_tables.sql`（新規作成）
* **具体的な操作**:
  1. `sql/ai/040_create_ai_v2_tables.sql` を新規作成し、V1の `ai_qa_logs` とは完全に分離された以下の2テーブルとインデックスのDDLを記述する。
     * `ai_conversations`（列: `id`, `title`, `created_at`, `updated_at`）
     * `ai_conversation_turns`（列: `id`, `conversation_id` [外部キー `REFERENCES ai_conversations(id) ON DELETE CASCADE`], `user_message`, `model_message`, `created_at`）
     * インデックス: `idx_ai_conversations_updated_at_desc`, `idx_ai_conversation_turns_conv_id_id`
  2. Neon の SQL Editor または `psql` コマンド（※要確認-02：プロジェクト内のマイグレーション実行スクリプトまたはNeonコンソールのいずれか利用可能な方法）を用いてDDLを実行し、テーブルを作成する。
  3. Neon コンソールまたは SQL クエリで以下を実行し、テーブル構造と制約を確認する。
     ```sql
     SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
     ```
* **期待する結果**:
  * `ai_conversations` と `ai_conversation_turns` の2テーブルが作成され、既存の `ai_qa_logs` や `todos` テーブルに影響がないこと。
  * 外部キー制約（`conversation_id` → `ai_conversations.id`）および `NOT NULL` / `CHECK` 制約が正しく付与されていること。
* **次へ進む条件**: Neon PostgreSQL 上に V2専用2テーブルとインデックスがエラーなく作成されていること。

---

### TASK-V2-03: 会話作成・一覧・履歴取得APIの実装
* **対応REQ・DES**: `REQ-V2-03`, `REQ-V2-04`, `REQ-V2-09`, `DES-V2-02`, `DES-V2-04`
* **変更ファイル**:
  * `src/apps/ai/v2/aiV2Model.ts`（新規作成）
  * `src/apps/ai/v2/aiV2Controller.ts`（新規作成）
  * `src/apps/ai/v2/aiV2Router.ts`（新規作成）
  * `index.ts`（既存改修：`/api/ai/v2` ルーターのマウント）
* **具体的な操作**:
  1. `src/apps/ai/v2/aiV2Model.ts` を作成し、パラメータ化クエリ（`$1, $2...`）で以下のDB操作関数を実装する（※要確認-01：`../../../db` からの `pool` インポートパスを確認）。
     * `findRecentConversations(limit = 20)`: `ORDER BY updated_at DESC, id DESC LIMIT $1` で会話一覧を取得。
     * `createConversation(title = '新しい会話')`: `INSERT INTO ai_conversations` で新規会話を作成し返却。
     * `findConversationById(conversationId)`: 指定IDの会話1件を取得（存在確認用）。
     * `findTurnsForDisplay(conversationId, limit = 20)`: `WHERE conversation_id = $1 ORDER BY id DESC LIMIT $2` で最新20往復を取得後、配列を反転（`.reverse()`）して古い順→新しい順で返却。
  2. `src/apps/ai/v2/aiV2Controller.ts` を作成し、全ハンドラ先頭に `process.env.GEMINI_API_KEY` 未設定時の **503停止ガード** を配置したうえで、以下3つのAPIハンドラを実装する。
     * `getConversations` (`GET /api/ai/v2/conversations`)
     * `createConversation` (`POST /api/ai/v2/conversations`)
     * `getConversationTurns` (`GET /api/ai/v2/conversations/:id/turns` — 不正IDは `400`、未存在IDは `404` を返却）
  3. `src/apps/ai/v2/aiV2Router.ts` を作成し、上記3ルートを登録する。
  4. `index.ts` に `aiV2Router` をインポートし、`app.use('/api/ai/v2', aiV2Router);` を追加する（既存の `app.use('/api/ai', aiRouter)` は変更しない）。
  5. ブラウザの DevTools コンソール等で以下の疎通テストを実施する。
     ```javascript
     // 1. 一覧取得（初期0件）
     await (await fetch('/api/ai/v2/conversations')).json();
     // 2. 新規会話作成
     await (await fetch('/api/ai/v2/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
     // 3. 履歴取得（作成されたIDを指定）
     await (await fetch('/api/ai/v2/conversations/1/turns')).json();
     ```
* **期待する結果**:
  * 新規会話作成で `201 Created`、一覧取得・履歴取得で `200 OK` が返ること。
  * 存在しないID（例: `99999`）に対して `404`、文字列ID（例: `abc`）に対して `400` が返ること。
* **次へ進む条件**: 会話の作成・一覧取得・空履歴取得の3つのAPIが正常に動作し、不正ID・未存在IDのエラー制御が確認できること。

---

### TASK-V2-04: 文脈付き質問送信と1往復保存APIの実装
* **対応REQ・DES**: `REQ-V2-01`, `REQ-V2-02`, `REQ-V2-07`, `REQ-V2-10`, `DES-V2-04`, `DES-V2-05`
* **変更ファイル**:
  * `src/apps/ai/v2/aiV2Service.ts`（新規作成）
  * `src/apps/ai/v2/aiV2Model.ts`（改修：文脈用5往復取得・1往復保存・タイトルと更新日時の更新を追加）
  * `src/apps/ai/v2/aiV2Controller.ts`（改修：`postTurn` ハンドラ追加）
  * `src/apps/ai/v2/aiV2Router.ts`（改修：`POST /conversations/:id/turns` ルート追加）
* **具体的な操作**:
  1. `src/apps/ai/v2/aiV2Model.ts` に以下を追加する。
     * `findRecentTurnsForContext(conversationId, limit = 5)`: `WHERE conversation_id = $1 ORDER BY id DESC LIMIT $2` で直近最大5往復を取得し、`.reverse()` で時系列昇順（古い順→新しい順）に並べ替えて返す。
     * `saveTurnAndTouchConversation(conversationId, userMessage, modelMessage, newTitleIfFirst)`: トランザクション内で `ai_conversation_turns` へ1往復を `INSERT` し、`ai_conversations` の `updated_at = NOW()`（初回往復時は `title` も先頭25文字で更新）を `UPDATE` する。
  2. `src/apps/ai/v2/aiV2Service.ts` を作成し、`@google/genai` を用いてマルチターン配列 `contents` を受け取り回答を生成する `generateTurnAnswer(contents)` を実装する。
     * `AbortController` による **30秒タイムアウト** と、空文字応答時の `EMPTY_RESPONSE` (502) 例外送出を組み込む。
     * 開発検証時に Gemini へ渡される `contents` 配列の構造（ロール順序・件数・会話スコープ）を確認できるよう、構造検証用のログ出力（またはテスト用模擬切り替えフック）を用意する。
  3. `src/apps/ai/v2/aiV2Controller.ts` に `postTurn` (`POST /api/ai/v2/conversations/:id/turns`) を設計書 `DES-V2-05` の厳密な順序で実装する。
     * **注意（リクエストキー名互換性）**: フロントエンドおよび検証コマンドの双方に対応できるよう、リクエストボディは `question`（または `prompt` のフォールバック受け入れ可否を確認し設計書通り `question` を正とする）の前後空白トリム後 **1〜2,000コードポイント** を検証する。
     * **順序**: ①公開停止ガード(503)・ID/入力検証(400)・会話存在確認(404) → ②`findRecentTurnsForContext(id, 5)` で対象会話の直近5往復取得 → ③過去往復を `{ role: 'user', parts: [{ text }] }` と `{ role: 'model', parts: [{ text }] }` に展開し、末尾に今回の質問を `{ role: 'user', parts: [{ text }] }` として追加 → ④`aiV2Service.generateTurnAnswer(contents)` 呼び出し → ⑤成功時のみ1往復をDB保存 → ⑥`201 Created` 返却。
  4. `aiV2Router.ts` に `aiV2Router.post('/conversations/:id/turns', aiV2Controller.postTurn);` を追加する。
  5. DevTools コンソールから会話A（ID: 1）と会話B（ID: 2）を作成し、以下を検証する。
     * 会話Aの1回目送信 → `contents` が `[user]` の1要素であること。
     * 会話Aの2回目送信（「さっきの合言葉は何ですか？」） → `contents` が `[user, model, user]` の3要素になり、文脈を踏まえた回答が返ること。
     * 会話Bの1回目送信 → `contents` が `[user]` の1要素のみであり、会話Aの履歴が混入しないこと。
* **期待する結果**:
  * 同じ会話内で前のやり取りを踏まえた回答が返り、DBに1往復ずつ保存されること。
  * 6往復目以降の送信でも、Gemini へ渡される過去文脈は直近5往復（10要素＋今回1要素＝計11要素）に制限されること。
  * 別会話の履歴が一切混入しないこと。
* **次へ進む条件**: 文脈付き連続対話、5往復上限制御、会話間の完全分離、および失敗時にDBへ不完全データが保存されないことが API レベルで確認できること。

---

### TASK-V2-05: V2画面UIと非同期クライアントの実装
* **対応REQ・DES**: `REQ-V2-03`, `REQ-V2-04`, `REQ-V2-05`, `REQ-V2-06`, `REQ-V2-07`, `DES-V2-06`, `DES-V2-07`
* **変更ファイル**:
  * `public/ai/v2/index.html`（新規作成）
  * `public/ai/v2/app.js`（新規作成）
  * `index.ts`（既存改修：`/ai/v2` および `/ai/v2/` の画面ルート追加）
* **具体的な操作**:
  1. `index.ts` に V2 画面のルーティングを追加する（`express.static` の配信に加え、`GET /ai/v2` と `GET /ai/v2/` の双方で `public/ai/v2/index.html` を返却するよう設定）。
  2. `public/ai/v2/index.html` を作成し、以下のUI要素を配置する。
     * 左サイドバー：「＋ 新しい会話」ボタン、保存済み会話一覧リスト（更新日時新しい順・最大20件）。
     * 右メインエリア：現在の会話タイトル、対話履歴表示コンテナ（最大20往復を上から古い順→新しい順で表示）、ステータス通知領域、質問入力フォーム（テキストエリア、文字数カウンタ、送信ボタン）。
     * V1画面（`/ai`）・TOP（`/`）・TODO（`/todo`）へのナビゲーションリンク。
  3. `public/ai/v2/app.js` を作成し、以下の制御を実装する。
     * **初期表示・リロード処理**: 起動時に `GET /api/ai/v2/conversations` を呼び出し一覧を描画。0件時は「保存された会話はありません」を正常表示。一覧クリック（または初期選択）で `GET /api/ai/v2/conversations/:id/turns` を呼び出し履歴を復元。
     * **新規会話作成**: 「＋ 新しい会話」ボタン押下で `POST /api/ai/v2/conversations` を実行し、空の対話画面へ即座に切り替え。
     * **非同期質問送信**: フォーム `submit` で `e.preventDefault()` を実行。`Array.from(trimmed).length` で 1〜2,000 コードポイントを検証。未選択状態なら先に新規会話を自動作成してから `POST /api/ai/v2/conversations/:id/turns` を送信。
     * **タイムアウトとロック制御**: 通信中は入力欄・送信ボタン・一覧切替ボタンを `disabled = true` / `aria-busy="true"` に設定。送信 `fetch` には `AbortController` で **45秒タイムアウト** を設定（自動再送なし）。
     * **成功・失敗時の状態制御**: 成功時のみ入力欄を空にして新しい1往復を画面末尾に追加（最大20往復超過時は先頭を削除）。失敗時（HTTPエラー・HTML応答・不正JSON・タイムアウト）は入力欄のテキストを保持し、エラーメッセージを表示。`finally` 節で必ずロック・ビジー状態を解除。
     * **XSS対策**: すべての動的テキスト（タイトル・質問・回答・日時）を `textContent` で描画し、`innerHTML` への文字列埋め込みを行わない。
* **期待する結果**:
  * `http://localhost:3000/ai/v2/` にアクセスし、会話の作成・一覧切替・連続質問・ブラウザ再読み込み後の再開が画面操作のみで完結すること。
  * `<script>alert('XSS')</script>` を入力しても実行されず文字列として描画されること。
* **次へ進む条件**: 画面上の全基本操作とXSS対策・通信ロック制御がブラウザ上で正常に動作すること。

---

### TASK-V2-06: 結合テスト・異常系テスト・回帰テストと提出準備
* **対応REQ・DES**: `REQ-V2-01`〜`REQ-V2-10`, `DES-V2-01`〜`DES-V2-07`
* **確認先・変更ファイル**:
  * 本手順書（`docs/ai/v2/implementation-plan.md`）第4章のテスト結果記録欄
  * Git リポジトリ（`git status`, `npm run build`）
* **具体的な操作**:
  1. 第4章「テスト項目・実測記録表」の `TEST-V2-01` 〜 `TEST-V2-10` をすべて順番に実行し、実測結果と合否判定を記録する。
  2. TypeScript の本番ビルドを実行し、型エラーやコンパイルエラーがないことを確認する。
     ```bash
     npm run build
     ```
  3. `.env` などの秘密情報が Git 追跡対象に含まれていないことを確認する。
     ```bash
     git status
     ```
* **期待する結果**:
  * すべてのテスト項目が「合格（OK）」となり、`npm run build` がエラーゼロで完了すること。
* **次へ進む条件**: 全テスト項目の合格記録が完了し、提出可能な状態が整うこと。

---

## 4. テスト項目・実測記録表（学生記録用）

※ 実装完了後、以下の各項目を実際に操作・確認し、「実測結果」および「判定（OK / NG）」欄に記録すること。

| テストID | テスト観点 | 操作手順 | 期待する結果 | 実測結果（学生記録欄） | 判定 |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **TEST-V2-01** | **初期0件表示と新規会話作成**<br>(`REQ-V2-03`, `REQ-V2-06`) | DBのV2テーブルが空の状態で `/ai/v2/` を開き、「＋ 新しい会話」を押下して初回質問を送信する。 | 0件時は正常案内が表示され、エラーにならない。新規作成後に初回質問が送信・保存され、一覧の先頭にタイトル付きで追加される。 | | |
| **TEST-V2-02** | **同じ会話での追加質問（文脈継続）**<br>(`REQ-V2-01`) | 会話Aで「合言葉は『しろくま47』です。」と送信し、続けて同じ会話Aで「さっきの合言葉は何ですか？」と送信する。 | Gemini へ `[user, model, user]` の順で送信され、回答に「しろくま47」が含まれる。画面に2往復目が表示される。 | | |
| **TEST-V2-03** | **別会話への文脈混入防止**<br>(`REQ-V2-02`) | 会話Aで合言葉を伝えた直後、「＋ 新しい会話」で会話Bを作成し、「さっきの合言葉は何ですか？」と送信する。 | Gemini へ `[user]` の1件のみ送信され、会話Aの「しろくま47」を参照せず分からない旨の回答が返る。 | | |
| **TEST-V2-04** | **文脈5往復上限と表示20往復上限**<br>(`REQ-V2-01`, `REQ-V2-04`) | 同一会話で6往復以上のやり取りを行い、7回目の質問を送信する。 | Gemini へ渡る過去履歴は直近5往復（10要素＋今回1要素）に制限され、画面には最大20往復まで古い順→新しい順で表示される。 | | |
| **TEST-V2-05** | **再読み込み後の会話選択と再開**<br>(`REQ-V2-05`) | 会話A・会話Bを作成した状態でブラウザをリロード（F5）し、一覧から会話Aを選択して追加質問を送信する。 | リロード後も一覧が保持され、会話Aを選ぶと過去履歴が復元される。追加質問も会話Aの文脈を引き継いで継続できる。 | | |
| **TEST-V2-06** | **不正または存在しない会話ID**<br>(`DES-V2-04`, `DES-V2-07`) | DevTools 等から `GET /api/ai/v2/conversations/abc/turns` および `POST /api/ai/v2/conversations/999999/turns` を送信する。 | 不正ID（`abc`）は `400 Bad Request`、存在しないID（`999999`）は `404 Not Found` のエラーJSONが返り、サーバーが落ちない。 | | |
| **TEST-V2-07** | **AI失敗・DB保存失敗時の挙動**<br>(`REQ-V2-07`, `DES-V2-07`) | 一時的に無効なAPIキーにするか通信を遮断した状態で質問を送信する。 | エラー案内が表示され、**入力欄の質問テキストは消えずに保持**される。不完全なデータ（質問のみ）はDBに保存されず、`finally` で再操作可能に戻る。 | | |
| **TEST-V2-08** | **XSS対策と入力バリデーション**<br>(`REQ-V2-06`, `REQ-V2-07`) | 質問欄に `<script>alert('XSS')</script>` を送信する。また、空白のみ・2,001文字以上で送信を試みる。 | スクリプトは実行されず文字列として安全に表示される。空文字・文字数超過は送信前にエラー表示されAPI通信が発生しない。 | | |
| **TEST-V2-09** | **V1およびTOP・TODOへの非干渉**<br>(`REQ-V2-08`) | `/`（TOP）、`/todo`（追加・完了・削除）、`/ai`（V1単発質問・履歴取得）にアクセスし操作する。 | V1の画面・API・DBテーブルおよびTOP・TODOのすべての機能が従来通り100%正常動作する。 | | |
| **TEST-V2-10** | **公開停止ガード（APIキー未設定時）**<br>(`REQ-V2-09`) | `.env` から `GEMINI_API_KEY` を一時削除してサーバーを再起動し、`/ai/v2/` および `/api/ai/v2/conversations` へアクセスする。 | サーバーがクラッシュせず **HTTP `503 Service Unavailable`** と停止案内が返り、DBやGeminiへの接続が行われない。 | | |