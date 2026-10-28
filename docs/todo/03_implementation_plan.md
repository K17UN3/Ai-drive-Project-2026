# TODO機能 実装計画書

本ドキュメントは、要件定義書 (`01_requirements.md`) および設計書 (`02_design.md`) に基づき、TODO機能を安全かつ段階的に実装・テスト・デプロイするための手順書である。

## 1. 全体手順フロー

 1. **作業用ブランチの作成 (Git)** (`git checkout -b feature/todo-v1`)
 2. **SQL保存 (Git)** (`sql/todo/020_create_todo_tasks.sql`)
 3. **SQL実行 (Neon手動)** (Neon SQL Editor)
 4. **REQ-01 一覧取得API** (`GET /api/v1/todos`)
 5. **REQ-02 登録API** (`POST /api/v1/todos`)
 6. **REQ-03 完了状態部分更新API** (`PATCH /api/v1/todos/:id`)
 7. **REQ-04 削除API** (`DELETE /api/v1/todos/:id`)
 8. **TodoApi通信クラス** (`public/todo/todo.js`)
 9. **画面描画 & イベント処理** (`views/todo/index.ejs`, `GET /todo`)
10. **ローカル環境テスト & ビルド確認 (Local)**
11. **Preview環境テスト (Vercel Preview)**
12. **PR作成・マージ (GitHub)**
13. **Production環境テスト (Vercel Production)**

---

## 2. 各工程の詳細手順

### 工程 1: 作業用ブランチの作成 (Git)

* **対象**: Git リポジトリ
* **作業内容**:
  `main` ブランチから機能開発用の作業ブランチ（例: `feature/todo-v1`）を作成・切り替える。
* **確認コマンド**:
  ```bash
  git checkout main
  git pull origin main
  git checkout -b feature/todo-v1
  ```
* **期待結果**: 現在のブランチが `feature/todo-v1` に切り替わっていること（`git branch` で確認）。
* **失敗時に最初に見る場所**: 未コミットの変更の有無、ブランチ名の重複。

---

### 工程 2: テーブル作成SQLの作成とGit保存

* **対象ファイル**: `sql/todo/020_create_todo_tasks.sql`
* **作業内容**:
  `todo_tasks` テーブル作成用の DDL スクリプトを作成・保存する。
  ```sql
  CREATE TABLE IF NOT EXISTS todo_tasks (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title TEXT NOT NULL,
    is_completed BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_title_length CHECK (char_length(title) >= 1 AND char_length(title) <= 100)
  );
  ```
* **確認コマンド**: `cat sql/todo/020_create_todo_tasks.sql`
* **期待結果**: 上記のDDL文が正確に出力されること。
* **失敗時に最初に見る場所**: ファイルパスの表記漏れ、`sql/todo/` ディレクトリの作成有無。

---

### 工程 3: Neon SQL Editor での手動実行

* **対象ファイル**: なし (Neon コンソール上の SQL Editor)
* **作業内容**:
  Neonの管理画面を開き、`sql/todo/020_create_todo_tasks.sql` の内容をSQL Editorに貼り付けて実行（Run）する。
* **確認コマンド**: Neon SQL Editor にて `SELECT * FROM todo_tasks;` を実行。
* **期待結果**: エラーなく実行され、`id`, `title`, `is_completed`, `created_at` カラムを持つ空の `todo_tasks` テーブルが作成されていること。
* **失敗時に最初に見る場所**: Neonの接続先データベース名、SQLの構文エラーメッセージ。

---

### 工程 4: REQ-01 一覧取得APIの実装

* **対象ファイル**:
  * `src/apps/todo/todoModel.ts`
  * `src/apps/todo/todoController.ts`
  * `src/apps/todo/todoRouter.ts`
  * `index.ts`
* **作業内容**:
  1. `todoModel.ts`: `db.ts` の `pool` を用い、`SELECT id, title, is_completed, created_at FROM todo_tasks ORDER BY id ASC;` を実行し、DBカラム名を camelCase (`isCompleted`, `createdAt`) に変換して返す `getTodos()` を実装。
  2. `todoController.ts`: `getTodos()` を呼び出し、`{ status: "success", data: [...] }` (HTTP 200) を返す `getTodos` ハンドラを作成。DBエラー時は `500 INTERNAL_ERROR` または `503 DB_UNAVAILABLE` を返却。
  3. `todoRouter.ts`: `router.get('/api/v1/todos', todoController.getTodos)` を定義。
  4. `index.ts`: 既存のトップページ `/` や `/api/db-check` の定義を壊さないよう、`express.json()` の有効化と `todoRouter` のマウント（`app.use('/', todoRouter)`）を追加。
* **確認コマンド**:
  ```bash
  npm run dev
  # 別のターミナルで実行
  curl -X GET http://localhost:3000/api/v1/todos
  ```
* **期待結果**: HTTP 200 で `{"status":"success","data":[]}` が返却されること（データ0件時）。
* **失敗時に最初に見る場所**: サーバーのコンソールログ、`db.ts` のデータベース接続設定、`index.ts` でのルーティング定義順。

---

### 工程 5: REQ-02 登録APIの実装

* **対象ファイル**:
  * `src/apps/todo/todoModel.ts`
  * `src/apps/todo/todoController.ts`
  * `src/apps/todo/todoRouter.ts`
* **作業内容**:
  1. `todoModel.ts`: `INSERT INTO todo_tasks (title) VALUES ($1) RETURNING id, title, is_completed, created_at;` を実行し、作成したTODOオブジェクトを返す `createTodo(title)` を実装。
  2. `todoController.ts`: リクエストボディから `title` を取得。欠落・型違い・JSON構文エラーなら `400 BAD_REQUEST`、トリム（前後空白除去）後の文字数が0文字または101文字以上なら `422 VALIDATION_ERROR` を返却。正常時は `createTodo` を実行し `{ status: "success", data: {...} }` (HTTP 201) を返却。
  3. `todoRouter.ts`: `router.post('/api/v1/todos', todoController.createTodo)` を追加。
* **確認コマンド**:
  ```bash
  # 正常系テスト
  curl -X POST http://localhost:3000/api/v1/todos -H "Content-Type: application/json" -d '{"title":"  テストTODO  "}'
  # バリデーションエラーテスト (422)
  curl -X POST http://localhost:3000/api/v1/todos -H "Content-Type: application/json" -d '{"title":""}'
  ```
* **期待結果**: 正常系では HTTP 201 が返り、`title` が前後空白除去された `"テストTODO"` となっていること。空文字送信時は HTTP 422 と共通エラーJSONが返ること。
* **失敗時に最初に見る場所**: `todoController.ts` 内のトリム・文字数チェック処理、`express.json()` ミドルウェアの有効化確認。

---

### 工程 6: REQ-03 完了状態の部分更新APIの実装

* **対象ファイル**:
  * `src/apps/todo/todoModel.ts`
  * `src/apps/todo/todoController.ts`
  * `src/apps/todo/todoRouter.ts`
* **作業内容**:
  1. `todoModel.ts`: `UPDATE todo_tasks SET is_completed = $1 WHERE id = $2 RETURNING id, title, is_completed, created_at;` を実行する `updateTodoStatus(id, isCompleted)` を実装。
  2. `todoController.ts`: パスパラメータ `:id` が1以上の整数か検証。リクエストボディの `isCompleted` が boolean 型か検証（不正・空の場合は `400 BAD_REQUEST`）。Modelを実行し、該当行が存在しない場合は `404 NOT_FOUND` を返却。正常時は HTTP 200 と更新後データを返却。
  3. `todoRouter.ts`: `router.patch('/api/v1/todos/:id', todoController.updateTodoStatus)` を追加。
* **確認コマンド**:
  ```bash
  # 正常系テスト (ID: 1 の場合)
  curl -X PATCH http://localhost:3000/api/v1/todos/1 -H "Content-Type: application/json" -d '{"isCompleted":true}'
  # 存在しないIDのテスト (404)
  curl -X PATCH http://localhost:3000/api/v1/todos/999999 -H "Content-Type: application/json" -d '{"isCompleted":true}'
  ```
* **期待結果**: 存在IDに対しては HTTP 200 と `"isCompleted": true` が返る。存在しないIDに対しては HTTP 404 と `NOT_FOUND` エラーJSONが返ること。
* **失敗時に最初に見る場所**: パスパラメータ `:id` の数値変換処理（`parseInt` 等）、SQLの `RETURNING` 結果判定。

---

### 工程 7: REQ-04 削除APIの実装

* **対象ファイル**:
  * `src/apps/todo/todoModel.ts`
  * `src/apps/todo/todoController.ts`
  * `src/apps/todo/todoRouter.ts`
* **作業内容**:
  1. `todoModel.ts`: `DELETE FROM todo_tasks WHERE id = $1 RETURNING id;` を実行する `deleteTodo(id)` を実装。
  2. `todoController.ts`: パスパラメータ `:id` が1以上の整数か検証（不正な場合は `400 BAD_REQUEST`）。Modelを実行し削除対象がなければ `404 NOT_FOUND` を返却。成功時は HTTP 204 (No Content、レスポンス本文なし) を返却。
  3. `todoRouter.ts`: `router.delete('/api/v1/todos/:id', todoController.deleteTodo)` を追加。
* **確認コマンド**:
  ```bash
  # 正常系テスト (ID: 1 の場合)
  curl -i -X DELETE http://localhost:3000/api/v1/todos/1
  # 存在しないIDのテスト (404)
  curl -i -X DELETE http://localhost:3000/api/v1/todos/999999
  ```
* **期待結果**: 正常系では `HTTP/1.1 204 No Content` が返りレスポンス本文が空であること。存在しないIDでは HTTP 404 が返ること。
* **失敗時に最初に見る場所**: `res.status(204).send()` 等のレスポンス処理（204でbodyを返していないか）。

---

### 工程 8: クライアントサイド通信クラス (TodoApi) の実装

* **対象ファイル**: `public/todo/todo.js`
* **作業内容**:
  設計書の `TodoApi` クラスを記述し、Fetch APIを用いて `/api/v1/todos` と通信する `getTodos()`, `createTodo(title)`, `updateTodoStatus(id, isCompleted)`, `deleteTodo(id)` を実装する。204 No Content では `res.json()` を呼び出さずに処理を終了させる。
* **確認コマンド**: ブラウザのデベロッパーツールのコンソールタブ等で構文エラーがないか確認。
* **期待結果**: JSのロード時にシンタックスエラーが発生しないこと。
* **失敗時に最初に見る場所**: `deleteTodo` 内での204判定ロジック、`fetch` の `res.ok` 判定。

---

### 工程 9: TODO画面 (EJS) および画面ルーティングの実装

* **対象ファイル**:
  * `views/todo/index.ejs`
  * `src/apps/todo/todoController.ts`
  * `src/apps/todo/todoRouter.ts`
  * `public/todo/todo.js` (DOM操作の追加)
* **作業内容**:
  1. `views/todo/index.ejs`: 入力フォーム（`#todo-title`）、追加ボタン、一覧表示領域（`#todo-list`）、エラー表示領域を作成。`<script src="/todo/todo.js"></script>` を読み込む。
  2. `todoController.ts`: `renderPage` ハンドラを実装し、`views/todo/index.ejs` をレンダリングして返却。
  3. `todoRouter.ts`: `router.get('/todo', todoController.renderPage)` を定義。
  4. `public/todo/todo.js`: 画面読み込み時に `getTodos` を呼び出し一覧描画。追加・完了切替・削除の各イベントハンドラを接続。タイトル描画時は `textContent` でエスケープを行う。データ0件時は「TODOがありません」を表示。エラー時はエラー領域に `message` を表示。
* **確認コマンド**: ブラウザで `http://localhost:3000/todo` にアクセス。
* **期待結果**: TODO管理画面が表示され、フォームおよび一覧が正常に機能すること。既存の `/` および `/api/db-check` に影響がないこと。
* **失敗時に最初に見る場所**: `views` ディレクトリ設定、静的ファイルパス (`public/todo/todo.js`)、ブラウザのデベロッパーツール（Console / Networkタブ）。

---

### 工程 10: ローカル環境での総合動作確認 & ビルド検証 (Local)

* **対象ファイル**: なし
* **作業内容**:
  1. 既存ルート `/` および `/api/db-check` の正常動作を確認。
  2. `/todo` 画面にて、新規登録（前後空白付き、100文字）、完了トグル、削除、入力エラー（空文字、101文字以上）の動作を確認。
  3. 0件状態（初回の空DBまたはデータ全削除後）で「TODOがありません」と表示されることを確認。
  4. TypeScriptの型チェックおよびビルドコマンドを実行し、コンパイルエラーが出ないことを確認する。
* **確認コマンド**:
  ```bash
  npm run build # または npx tsc --noEmit
  npm run dev
  ```
* **期待結果**: ビルドエラーがゼロであり、要件定義書の REQ-01 ～ REQ-04 のすべての受け入れ条件を満たしていること。
* **失敗時に最初に見る場所**: TypeScript型定義エラー（`tsconfig.json` の設定や型指定漏れ）、サーバーコンソールログ。

---

### 工程 11: Vercel Preview 環境での動作確認

* **対象ファイル**: なし
* **作業内容**:
  1. 変更を作業ブランチにコミットし、GitHub に Push して Pull Request (PR) を作成する。
  2. Vercel が自動生成する Preview URL にアクセスする。
  3. Preview 環境にて、REQ-01 ～ REQ-04 の操作、エラー系操作、既存ルート `/` `/api/db-check` の動作を確認する。
  4. （DBに既存データがあり0件テストが実施できない場合は、その理由を記録する）
* **確認コマンド**: Preview URL へのアクセスとブラウザ操作。
* **期待結果**: Local 環境と同様に、すべてのAPIおよび画面操作が正常に動作すること。
* **失敗時に最初に見る場所**: Vercel の Deployment Logs、Neon DB の接続状態（`DATABASE_URL` 環境変数の設定）。

---

### 工程 12: PR作成・マージ (GitHub)

* **対象ファイル**: Git リポジトリ上の全変更ファイル
* **作業内容**:
  1. Preview 環境での確認完了後、PRのレビューを行う。
  2. `main` ブランチへ PR をマージする。
* **確認コマンド**: GitHub 上で Merge ボタンを押下。
* **期待結果**: `main` ブランチに正常にコードが統合され、Vercel Production デプロイが開始されること。
* **失敗時に最初に見る場所**: GitHub PRのコンフリクト状態、CI/CDビルドログ。

---

### 工程 13: Production 環境での動作確認

* **対象ファイル**: なし
* **作業内容**:
  1. 本番 URL (Production) にアクセスする。
  2. REQ-01 ～ REQ-04 の操作（一意な架空タイトルでの登録、更新、削除）、および `/` `/api/db-check` の動作を確認する。
  3. 確認結果（URL、日時、結果）を `docs/todo/04_test_results.md` に記録する。
* **確認コマンド**: 本番 URL へのアクセスとブラウザ操作。
* **期待結果**: 本番環境でもすべての機能が正常に動作し、既存機能に影響がないこと。
* **失敗時に最初に見る場所**: Vercel Production の Logs、Neon DB の本番接続状態。