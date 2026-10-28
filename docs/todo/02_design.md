# TODOアプリ V1 設計書

本ドキュメントは、要件定義書 (`docs/todo/01_requirements.md`) に基づくTODO機能の追加実装における詳細設計書である。

---

## 1. 作るものとファイル構成

既存の Express + TypeScript + EJS 構成（トップページ `/` および DB接続確認 `/api/db-check`）を維持したまま、TODO機能（画面: `/todo`, API: `/api/v1/todos`）を追加する。

### 追加・関連ファイル配置

* **`src/apps/todo/`**
  * `todoRouter.ts`: 画面 (`/todo`) および REST API (`/api/v1/todos`) のルーティング定義
  * `todoController.ts`: リクエスト検証、HTTPステータス制御、レスポンス整形
  * `todoModel.ts`: DB (`todo_tasks`) に対するSQLクエリ実行および命名変換 (`snake_case` ↔ `camelCase`)
* **`views/todo/`**
  * `index.ejs`: TODO管理画面のHTMLテンプレート
* **`public/todo/`**
  * `todo.js`: Fetch API 通信クラス (`TodoApi`) および画面の DOM 操作スクリプト
* **`sql/todo/`**
  * `020_create_todo_tasks.sql`: `todo_tasks` テーブル作成用の DDL スクリプト
* **`docs/todo/`**
  * `01_requirements.md`: 要件定義書（変更なし）
  * `02_design.md`: 本設計書
  * `03_implementation_plan.md`: 実装計画書
  * `04_test_results.md`: テスト結果記録書

---

## 2. エントリーポイント (`index.ts`) への統合

既存の `index.ts` の動作（トップページ `/` や `/api/db-check`）を阻害しないよう、ミドルウェアの設定順と `todoRouter` のマウント位置を以下のように指定する。

```typescript
import express from 'express';
import { todoRouter } from './src/apps/todo/todoRouter'; // 追加

const app = express();

// --- ミドルウェア設定 ---
app.use(express.json()); // POST/PATCH の JSON Body パース用（必須）
app.use(express.static('public')); // 静的ファイル (public/todo/todo.js 等)

// --- ルーティング登録 ---
// 既存ルート (例: app.get('/', ...), app.get('/api/db-check', ...))

// TODO機能のルーティングを追加 (/todo および /api/v1/todos を一括マウント)
app.use('/', todoRouter);
```

---

## 3. データベース設計 (`todo_tasks`)

### テーブル定義

テーブル名: `todo_tasks`

| カラム名 (snake_case) | データ型 | 制約 | 初期値 | 概要 | 対応要件 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY`, 自動採番 | 自動生成 | TODO一意ID (1以上の整数) | REQ-01, REQ-03, REQ-04 |
| `title` | `TEXT` | `NOT NULL`, `CHECK (char_length(title) >= 1 AND char_length(title) <= 100)` | なし | TODOタイトル (1〜100文字) | REQ-02 |
| `is_completed` | `BOOLEAN` | `NOT NULL` | `false` | 完了フラグ | REQ-02, REQ-03 |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` | `NOW()` | 作成日時 | REQ-01, REQ-02 |

### DDL (`sql/todo/020_create_todo_tasks.sql`)

```sql
CREATE TABLE IF NOT EXISTS todo_tasks (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_title_length CHECK (char_length(title) >= 1 AND char_length(title) <= 100)
);
```

---

## 4. API詳細設計 (REQ-01 〜 REQ-04)

JSONのプロパティは **camelCase**、DBのカラム名は **snake_case** を使用し、`todoModel.ts` で相互変換を行う。

### 4 API操作一覧表

| 要件ID | 操作名 | メソッド | URL | リクエスト本文 | 成功ステータス / JSON例 | 失敗ステータス / JSON例 | DB処理 (SQL) | TodoApi メソッド | 確認方法 (curl / 操作) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **REQ-01** | 一覧取得 | `GET` | `/api/v1/todos` | なし | **200 OK**<br>```json\n{\n  "status": "success",\n  "data": [\n    {\n      "id": 1,\n      "title": "課題提出",\n      "isCompleted": false,\n      "createdAt": "2026-10-14T10:00:00Z"\n    }\n  ]\n}\n```<br>*(0件時は `data: []`)* | **500 / 503**<br>```json\n{\n  "status": "error",\n  "code": "INTERNAL_ERROR",\n  "message": "データベースエラーが発生しました",\n  "details": []\n}\n``` | `SELECT id, title, is_completed, created_at FROM todo_tasks ORDER BY id ASC;` | `getTodos(): Promise<Todo[]>` | `curl -X GET http://localhost:3000/api/v1/todos` |
| **REQ-02** | 登録 | `POST` | `/api/v1/todos` | ```json\n{\n  "title": " 課題を提出する "\n}\n``` | **201 Created**<br>```json\n{\n  "status": "success",\n  "data": {\n    "id": 1,\n    "title": "課題を提出する",\n    "isCompleted": false,\n    "createdAt": "2026-10-14T10:00:00Z"\n  }\n}\n``` | **400 BAD_REQUEST** (JSON不可/欠落)<br>**422 VALIDATION_ERROR** (空文字/101文字超)<br>```json\n{\n  "status": "error",\n  "code": "VALIDATION_ERROR",\n  "message": "タイトルは1文字以上100文字以内で入力してください",\n  "details": []\n}\n``` | `INSERT INTO todo_tasks (title) VALUES ($1) RETURNING id, title, is_completed, created_at;` | `createTodo(title: string): Promise<Todo>` | `curl -X POST http://localhost:3000/api/v1/todos -H "Content-Type: application/json" -d '{"title":"テスト"}'` |
| **REQ-03** | 完了状態部分更新 | `PATCH` | `/api/v1/todos/:id` | ```json\n{\n  "isCompleted": true\n}\n``` | **200 OK**<br>```json\n{\n  "status": "success",\n  "data": {\n    "id": 1,\n    "title": "課題を提出する",\n    "isCompleted": true,\n    "createdAt": "2026-10-14T10:00:00Z"\n  }\n}\n``` | **400 BAD_REQUEST** (ID不正/型違い)<br>**404 NOT_FOUND** (ID不在)<br>```json\n{\n  "status": "error",\n  "code": "NOT_FOUND",\n  "message": "指定されたTODOが見つかりません",\n  "details": []\n}\n``` | `UPDATE todo_tasks SET is_completed = $1 WHERE id = $2 RETURNING id, title, is_completed, created_at;` | `updateTodoStatus(id: number, isCompleted: boolean): Promise<Todo>` | `curl -X PATCH http://localhost:3000/api/v1/todos/1 -H "Content-Type: application/json" -d '{"isCompleted":true}'` |
| **REQ-04** | 削除 | `DELETE` | `/api/v1/todos/:id` | なし | **204 No Content**<br>*(レスポンス本文なし)* | **400 BAD_REQUEST** (ID不正)<br>**404 NOT_FOUND** (ID不在)<br>```json\n{\n  "status": "error",\n  "code": "NOT_FOUND",\n  "message": "指定されたTODOが見つかりません",\n  "details": []\n}\n``` | `DELETE FROM todo_tasks WHERE id = $1 RETURNING id;` | `deleteTodo(id: number): Promise<void>` | `curl -i -X DELETE http://localhost:3000/api/v1/todos/1` |

---

## 5. クライアントサイド通信クラス設計 (`public/todo/todo.js`)

```javascript
class TodoApi {
  async getTodos() {
    const res = await fetch('/api/v1/todos');
    const json = await res.json();
    if (!res.ok) throw json;
    return json.data;
  }

  async createTodo(title) {
    const res = await fetch('/api/v1/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    const json = await res.json();
    if (!res.ok) throw json;
    return json.data;
  }

  async updateTodoStatus(id, isCompleted) {
    const res = await fetch(`/api/v1/todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isCompleted }),
    });
    const json = await res.json();
    if (!res.ok) throw json;
    return json.data;
  }

  async deleteTodo(id) {
    const res = await fetch(`/api/v1/todos/${id}`, {
      method: 'DELETE',
    });
    if (res.status === 204) return;
    const json = await res.json();
    if (!res.ok) throw json;
  }
}
```

---

## 6. 要確認事項 (曖昧な点)

実装にあたり、現時点で確定していない事項・既存コード依存の確認が必要な項目を以下に列挙する。

1. **`db.ts` の詳細配置とプール変数名 (要確認)**:
   * 接続モジュールがルート直下の `db.ts` であるか、または `src/db.ts` や `src/config/db.ts` 等であるか。また、エクスポート名が `pool`（`pg.Pool`インスタンス）であるか。
2. **EJSテンプレートの共通レイアウト・ヘッダー構造 (要確認)**:
   * `views/todo/index.ejs` を作成する際、既存の共通ヘッダー・フッター・CSSフレームワーク（BootstrapやTailwind等）の読み込みルールが存在するか。
3. **静的ファイル公開ディレクトリ名 (要確認)**:
   * `express.static('public')` が設定済みであるか。`/todo/todo.js` としてブラウザからアクセス可能なルート設定になっているか。
4. **既存のエラーミドルウェアとの統合 (要確認)**:
   * 既存プロジェクトで共通の集中型エラーハンドリングミドルウェア（`app.use((err, req, res, next) => ...)`）が存在するか。存在する場合は `todoController.ts` から `next(err)` で移送するか、各ハンドラで完結してレスポンスを返すか。