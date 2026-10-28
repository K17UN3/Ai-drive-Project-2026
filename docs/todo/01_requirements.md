# TODO機能 要件定義書
V1 完成見本｜既存のExpress＋TypeScript＋EJSサイトに追加するTODO機能

## 1. 目的と完成条件

授業の受講者が、ブラウザでTODOの一覧表示・登録・完了切替・削除をできるようにする。データはNeon PostgreSQLに保存し、画面の操作はFetch APIを介してREST APIへ送る。

完成時には、既存のトップページ「`/`」とDB接続確認「`/api/db-check`」を残したまま、画面「`/todo`」とAPI「`/api/v1/todos`」が動く。Local、Vercel Preview、Productionで確認した結果を記録する。

## 2. 対象範囲と共通の前提

* **V1で作るもの**: TODOの一覧・登録・完了切替・削除、`/todo` の画面、REST API、`todo_tasks` テーブル、環境別のテスト記録。
* **V1で作らないもの**: 認証、優先度、絞り込み、タイトルの更新。
* **DB接続**: 既存の処理（例：`db.ts`。実際の配置を確認）と環境変数 `DATABASE_URL` を利用する。接続文字列や `.env` はGitに追加せず、AIにも渡さない。
* **セキュリティ・データ運用**: 認証のない公開URLでは第三者もTODOを閲覧・変更・削除できる。架空の授業用データだけを使い、個人情報や重要な情報を登録しない。各学生が用意したNeon DBを、その学生のPreviewとProductionで共通利用する。

## 3. 機能要件

各REQについて、操作と受け入れ条件をセットで確認する。APIの共通JSON形式とエラーコードは第5章・第6章による。

### 3.1 REQ-01 一覧取得

GET `/api/v1/todos` で登録済みのTODOを `id` の昇順に取得する。入力はない。成功時は200でTODOの配列を `data` に返す。

* **操作**: 画面アクセス時または更新時に GET `/api/v1/todos` を実行。
* **入力**: なし
* **結果**: HTTP 200 で `{"status":"success", "data": [...]}` を返却。
* **受け入れ条件**: 1件以上あるときは `id` 昇順で表示される。0件なら200で `data` は `[]` となり、`/todo` に「TODOがありません」と表示される。0件は初回の空DBまたは講師指定の隔離環境で確認する。

### 3.2 REQ-02 登録

POST `/api/v1/todos` にJSONで `title` を送る。アプリ側で前後の空白を除き、1～100文字であることを確認してから保存する。`isCompleted` は `false` で開始する。成功時は201で採番済みのTODOを `data` に返す。

* **操作**: タイトルを入力し送信ボタン押下で POST `/api/v1/todos` を実行。
* **入力例**: `{"title":"課題を提出する"}`
* **結果**: HTTP 201 で `{"status":"success", "data": {...}}` を返却。
* **受け入れ条件**: 前後に空白を付けて登録しても、保存値と応答の `title` は空白除去後の値になる。`title` の欠落・型違い・JSONの構文エラーは400、空白だけ・101文字以上は422を返す。

### 3.3 REQ-03 完了状態の部分更新

PATCH `/api/v1/todos/:id` にJSONで `isCompleted` の真偽値を送る。`:id` は1以上の整数とし、指定したTODOの完了状態だけを更新する。成功時は200で更新後のTODOを `data` に返す。V1では `title` を更新しない。

* **操作**: チェックボックスの変更時等に PATCH `/api/v1/todos/:id` を実行。
* **入力例**: `{"isCompleted":true}`
* **結果**: HTTP 200 で `{"status":"success", "data": {...}}` を返却。
* **受け入れ条件**: 登録時に返されたIDを使うと、そのTODOだけの状態が変わる。ID形式が不正、本文が空、`isCompleted` が真偽値でない場合は400、形式が正しく存在しないIDは404を返す。

### 3.4 REQ-04 削除

DELETE `/api/v1/todos/:id` で指定したTODOを削除する。`:id` は1以上の整数とする。成功時は204で本文を返さない。

* **操作**: 削除ボタン押下で DELETE `/api/v1/todos/:id` を実行。
* **入力**: パスパラメータ `:id`（1以上の整数）。
* **結果**: HTTP 204（本文なし）。
* **受け入れ条件**: 登録時に返されたIDを削除すると、その行が一覧から消える。ID形式が不正なら400、形式が正しく存在しないIDなら404を返す。

## 4. 画面とブラウザ側の要件

* **UI構成**: `/todo` は既存構成に合わせたEJSテンプレートで表示する。タイトル入力欄（最大100文字）と追加ボタン、各TODOの完了チェックボックスと削除ボタンを備える。0件、処理中、入力エラー、通信エラーを画面に表示する。
* **データ通信**: 画面の一覧・登録・完了切替・削除はFetch APIでREST APIへ送る。操作後は一覧を再取得し、TODOのタイトルを安全に表示する。通信処理のクラス構成やメソッド名は設計書で決める（既存ファイルの配置は確認し、推測で固定しない）。
* **エラーハンドリング**: 通信エラーやAPIのエラーが起きたら、共通エラーJSONの `code` と `message` を用いて画面に分かりやすく知らせる。DELETEの204では応答本文を受け取らない。

## 5. データとAPIの共通仕様

### DB仕様
* **テーブル名**: `todo_tasks`
* **カラム構造**:
  * `id`: INTEGER（自動採番・主キー）
  * `title`: TEXT（必須。アプリ側で空白除去および1～100文字の検証を実施）
  * `is_completed`: BOOLEAN（必須・初期値 `false`）
  * `created_at`: TIMESTAMPTZ（必須・初期値 `NOW()`）
* **テーブル作成SQL**: `sql/todo/020_create_todo_tasks.sql` に保存する。

### APIオブジェクト仕様
APIのTODO型表現: `{ "id": number, "title": string, "isCompleted": boolean, "createdAt": string }`
※DBの `is_completed` と `created_at` は、それぞれ `isCompleted` と `createdAt` へ変換して返却する。

### 応答フォーマット
* **成功（GET/POST/PATCH）**: `{"status":"success", "data": ...}` （GETで0件なら `{"status":"success", "data":[]}`）
* **成功（DELETE）**: 204 No Content（本文なし）
* **エラー共通**: `{"status":"error", "code":"...", "message":"...", "details":[]}`
※レスポンスにSQL文、DB接続文字列、サーバー内部の詳細を含めない。

## 6. エラーとHTTPステータス

* **400 BAD_REQUEST**: JSONの構文エラー、必須項目の欠落、型違い、1以上の整数ではないID、PATCHの空本文。
* **422 VALIDATION_ERROR**: 空白除去後の `title` が0文字または101文字以上。
* **404 NOT_FOUND**: 形式が正しいIDに対応するTODOが存在しない。
* **500 INTERNAL_ERROR**: サーバー内部エラーやSQL実行エラー。
* **503 DB_UNAVAILABLE**: DB接続が利用できない。

※上記エラー発生時は第5章の共通エラーJSONを返す。DBやSQLの詳細はサーバー側のログで確認し、利用者への応答には出さない。

## 7. 確認・提出条件

1. Local、Vercel Preview、Productionの各環境で、4操作の正常系、入力エラー、存在しないID、画面操作、既存の「`/`」と「`/api/db-check`」を確認する。ProductionはPRマージ後に確認する。
2. 環境ごとのURL・日時・結果を `docs/todo/04_test_results.md` に記録する。
3. PreviewとProductionが共通利用する学生自身のDBに既存データがある場合、0件テストのために既存の行を削除しない。0件テストを実施できない理由を記録する。
4. 登録には架空の一意なタイトルを使い、応答から取得した自分のIDだけを更新・削除する。
5. 確定した本文を `docs/todo/01_requirements.md` に保存し、設計書とテスト結果でも REQ-01～REQ-04 を参照する。