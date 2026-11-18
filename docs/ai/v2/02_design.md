# AI質問アプリV2 設計書

## 1. システム全体構成と設計方針

### 1.1 基本方針 (`DES-V2-01`)
* **対応REQ**: `REQ-V2-08`（V1および既存機能への非干渉）, `REQ-V2-09`（公開時の安全な機能停止ガード）
* **設計内容**:
  * V1の画面（`/ai`）・API（`/api/ai/*`）・DBテーブル（`ai_qa_logs`）には一切の変更を加えず、V2専用の入り口（画面 `/ai/v2/`、API `/api/ai/v2/*`）およびV2専用DBテーブルを独立して構築する。
  * V1と同じレイヤード構成（`Router` → `Controller` → `Service` / `Model`）およびフロントエンドの静的ファイル配信構成（`public/ai/v2/index.html`, `public/ai/v2/app.js`）を踏襲する。
  * 環境変数 `GEMINI_API_KEY` 未設定時は、全V2ルート・APIの先頭で即座に **HTTP `503 Service Unavailable`** を返却し、DBやGemini APIへの接続を完全に遮断する。

---

## 2. ファイル構成と各ファイルの役割 (`DES-V2-02`)

* **対応REQ**: `REQ-V2-08`

V1の実際のファイル配置（`index.ts`, `src/apps/ai/*`, `public/ai/*`, `sql/ai/*`）に合わせて以下の通り配置する。

| ファイルパス | 区分 | 役割・責務 |
| :--- | :---: | :--- |
| `index.ts` | 既存改修 | `/ai/v2` の静的画面ルーティング追加、および `/api/ai/v2` への `aiV2Router` マウント（`express.json({ limit: '10kb' })` 適用）。 |
| `sql/ai/040_create_ai_v2_tables.sql` | 新規 | V2専用テーブル（`ai_conversations`, `ai_conversation_turns`）およびインデックス作成用DDL。 |
| `src/apps/ai/v2/aiV2Router.ts` | 新規 | `/api/ai/v2/conversations` 配下のエンドポイント定義と `aiV2Controller` へのバインド。 |
| `src/apps/ai/v2/aiV2Controller.ts` | 新規 | 公開停止ガード（503）、入力・パラメータ検証（400/404）、文脈組み立てオーケストレーション、HTTPレスポンス整形。 |
| `src/apps/ai/v2/aiV2Model.ts` | 新規 | `ai_conversations` と `ai_conversation_turns` に対するパラメータ化クエリ（会話作成・一覧取得・往復履歴取得・往復保存・更新日時更新）。 |
| `src/apps/ai/v2/aiV2Service.ts` | 新規 | `@google/genai` を用いたマルチターン対話生成（直近5往復の `user`/`model` 履歴＋最新質問の送信、30秒タイムアウト制御）。 |
| `public/ai/v2/index.html` | 新規 | 会話一覧サイドバー、「新しい会話」ボタン、最大20往復の対話表示エリア、質問送信フォームを備えたV2画面HTML。 |
| `public/ai/v2/app.js` | 新規 | 非同期API通信、会話切替・新規作成状態管理、コードポイント長検証、45秒ブラウザタイムアウト、`textContent` によるXSS安全なDOM描画。 |

* **【要確認事項】**:
  * **要確認-01**: `db.ts` の配置場所（V1の `aiModel.ts` では `import { pool } from '../../../db';` となっているため、ルート直下の `db.ts` をそのまま利用可能か最終確認する）。
  * **要確認-02**: `index.ts` で `/ai` に対して静的ファイル (`public/ai/index.html`) と `aiRouter` (`views/ai/index.ejs`) の両方が定義されているため、V2では `/ai/v2` と `/ai/v2/` の双方で `public/ai/v2/index.html` が確実に配信されるよう `express.static` と明示的ルートで統一する。

---

## 3. データベース設計 (`DES-V2-03`)

* **対応REQ**: `REQ-V2-02`（別会話への混入防止）, `REQ-V2-04`（会話一覧・20往復表示）, `REQ-V2-05`（再読み込み後の復元）

V1の `ai_qa_logs` とは完全に分離し、**「会話スレッドテーブル」**と**「会話の1往復テーブル」**の2テーブル構成とする。

### 3.1 会話スレッドテーブル (`ai_conversations`)
| 列名 | データ型 | 制約・デフォルト | 説明 |
| :--- | :--- | :--- | :--- |
| `id` | `BIGINT` | `GENERATED ALWAYS AS IDENTITY PRIMARY KEY` | 会話ID（主キー） |
| `title` | `VARCHAR(100)` | `NOT NULL DEFAULT '新しい会話'` | 会話一覧に表示するタイトル（初回質問の先頭25文字等で更新） |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | 会話作成日時 |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | 最終発言日時（往復保存時に更新） |

* **インデックス・並び順**:
  * `idx_ai_conversations_updated_at_desc` ON `ai_conversations(updated_at DESC, id DESC)`
  * 一覧取得時は `ORDER BY updated_at DESC, id DESC LIMIT 20` で新しい順に取得する。

### 3.2 会話往復テーブル (`ai_conversation_turns`)
1レコードで「ユーザーの質問（1回）」と「AIの回答（1回）」の**1往復（Turn）**を保持する。これにより、API障害時に質問だけが単独保存される不整合を防ぎ、往復単位の件数制御（5往復・20往復）を厳密に行える。

| 列名 | データ型 | 制約・デフォルト | 説明 |
| :--- | :--- | :--- | :--- |
| `id` | `BIGINT` | `GENERATED ALWAYS AS IDENTITY PRIMARY KEY` | 往復ID（主キー） |
| `conversation_id` | `BIGINT` | `NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE` | 外部キー（所属する会話ID） |
| `user_message` | `TEXT` | `NOT NULL` + `CHECK (char_length(btrim(user_message)) > 0)` | ユーザーの質問テキスト |
| `model_message` | `TEXT` | `NOT NULL` + `CHECK (char_length(btrim(model_message)) > 0)` | Geminiの回答テキスト |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` | 往復の保存日時 |

* **インデックス・並び順**:
  * `idx_ai_conversation_turns_conv_id_id` ON `ai_conversation_turns(conversation_id, id DESC)`
  * **画面表示用（最大20往復）**: `WHERE conversation_id = $1 ORDER BY id DESC LIMIT 20` で最新20往復を取得後、配列を反転（昇順化）して「古い順→新しい順（上から下）」で画面に描画する。
  * **Gemini文脈用（最大5往復）**: `WHERE conversation_id = $1 ORDER BY id DESC LIMIT 5` で直近5往復を取得後、配列を反転（昇順化）してAIへ渡す。

---

## 4. APIインターフェース設計 (`DES-V2-04`)

* **対応REQ**: `REQ-V2-01`〜`REQ-V2-10`

すべてのV2 APIは `/api/ai/v2` をプレフィックスとし、JSON形式（`Content-Type: application/json`）で通信する。

### 4.1 APIエンドポイント一覧
| No | メソッド | URL | 役割 | 正常ステータス |
| :---: | :--- | :--- | :--- | :---: |
| 1 | `GET` | `/api/ai/v2/conversations` | 保存済み会話スレッド一覧の取得（最新20件・更新日時降順） | `200 OK` |
| 2 | `POST` | `/api/ai/v2/conversations` | 新規会話スレッドの作成 | `201 Created` |
| 3 | `GET` | `/api/ai/v2/conversations/:id/turns` | 指定会話の往復履歴取得（最新20往復・時系列昇順返却） | `200 OK` |
| 4 | `POST` | `/api/ai/v2/conversations/:id/turns` | 指定会話への追加質問送信・AI応答生成・1往復保存 | `201 Created` |

### 4.2 各APIの詳細仕様

#### ① 会話一覧取得: `GET /api/ai/v2/conversations`
* **入力**: なし（クエリパラメータ不要）
* **応答 (`200 OK`)**:
```json
{
  "status": "success",
  "data": {
    "conversations": [
      {
        "id": 12,
        "title": "TypeScriptの型定義について",
        "createdAt": "2026-11-18T05:30:00.000Z",
        "updatedAt": "2026-11-18T05:35:10.000Z"
      }
    ]
  }
}
```
※ 0件の場合は `"conversations": []` を返す。

#### ② 新規会話作成: `POST /api/ai/v2/conversations`
* **入力**: `{ "title": "任意タイトル" }`（省略時はサーバー側で `'新しい会話'` を設定）
* **応答 (`201 Created`)**:
```json
{
  "status": "success",
  "data": {
    "conversation": {
      "id": 13,
      "title": "新しい会話",
      "createdAt": "2026-11-18T06:00:00.000Z",
      "updatedAt": "2026-11-18T06:00:00.000Z"
    }
  }
}
```

#### ③ 会話の往復履歴取得: `GET /api/ai/v2/conversations/:id/turns`
* **入力**: パスパラメータ `:id`（正の整数）
* **異常判定**:
  * `:id` が正の整数でない場合 → `400 Bad Request` (`INVALID_CONVERSATION_ID`)
  * 指定 `:id` の会話が `ai_conversations` に存在しない場合 → `404 Not Found` (`CONVERSATION_NOT_FOUND`)
* **応答 (`200 OK`)**: 最新20往復を時系列順（古い順→新しい順）で返却。
```json
{
  "status": "success",
  "data": {
    "conversation": {
      "id": 12,
      "title": "TypeScriptの型定義について"
    },
    "turns": [
      {
        "id": 101,
        "userMessage": "interfaceとtypeの違いは？",
        "modelMessage": "主な違いは拡張性（declaration merging）と表現できる型（Union型など）にあります。",
        "createdAt": "2026-11-18T05:30:05.000Z"
      }
    ]
  }
}
```

#### ④ 質問送信・1往復生成: `POST /api/ai/v2/conversations/:id/turns`
* **入力**:
  * パスパラメータ `:id`（正の整数）
  * リクエストボディ: `{ "question": "string" }`
* **応答 (`201 Created`)**:
```json
{
  "status": "success",
  "data": {
    "conversation": {
      "id": 12,
      "title": "interfaceとtypeの違いは？",
      "updatedAt": "2026-11-18T05:35:10.000Z"
    },
    "turn": {
      "id": 102,
      "userMessage": "具体例をコードで示して",
      "modelMessage": "以下にTypeScriptでの具体例を示します...",
      "createdAt": "2026-11-18T05:35:10.000Z"
    }
  }
}
```

---

## 5. 質問送信処理シーケンス（文脈組み立てと保存） (`DES-V2-05`)

* **対応REQ**: `REQ-V2-01`（直近5往復文脈）, `REQ-V2-02`（混入防止）, `REQ-V2-07`（失敗時の整合性）

`POST /api/ai/v2/conversations/:id/turns` を受信した際、サーバー側は以下の**厳密な6ステップ順序**で処理を実行する。

1. **ステップ1：入力検証と会話の存在確認**
   * `GEMINI_API_KEY` の存在確認（未設定時は `503`）。
   * パスパラメータ `:id` が正の整数であることを検証（不正時は `400`）。
   * `req.body.question` が文字列であることを確認し、前後空白を `trim()` したうえで **コードポイント長（`Array.from(trimmed).length`）が 1〜2,000 文字以内** であることを検証（範囲外は `400`）。
   * DB（`ai_conversations`）から `WHERE id = $1` で会話レコードを取得し、存在しない場合は `404 Not Found` を返却して処理を中断する。
2. **ステップ2：同じ会話の履歴取得（直近5往復）**
   * DB（`ai_conversation_turns`）から `WHERE conversation_id = $1 ORDER BY id DESC LIMIT 5` を実行し、対象会話の直近最大5往復のみを取得する。
   * 取得した配列を時系列昇順（古い往復 → 新しい往復）に並べ替える。
3. **ステップ3：Gemini用 `contents` 配列の組み立て**
   * 取得した過去履歴（最大5往復）の各往復について、以下の順序で `contents` 配列へ追加する。
     * 過去の質問 → `{ role: 'user', parts: [{ text: turn.userMessage }] }`
     * 過去の回答 → `{ role: 'model', parts: [{ text: turn.modelMessage }] }`
   * 配列の末尾に、今回の新しい質問を最後の `user` として追加する。
     * 今回の質問 → `{ role: 'user', parts: [{ text: trimmedQuestion }] }`
   * （例：過去2往復がある場合、`user` → `model` → `user` → `model` → `user(今回)` の計5要素となる）
4. **ステップ4：Gemini API 呼び出し**
   * `aiV2Service.generateTurnAnswer(contents)` を呼び出す。
   * モデルは `process.env.GEMINI_MODEL || 'gemini-2.5-flash'`、出力上限は `maxOutputTokens: 1024`（または文脈応答に適した設定）、タイムアウトは `AbortController` により **30秒** に制限する（自動リトライなし）。
   * 空文字応答やAPI例外が発生した場合は `AiServiceError` を送出し、**ステップ5へ進まずエラー応答を返す（DBに不完全データを保存しない）**。
5. **ステップ5：1往復のDB保存と会話メタデータ更新**
   * トランザクション（または連続クエリ）により以下を実行する。
     1. `ai_conversation_turns` へ `(conversation_id, user_message, model_message)` を 1レコードとして `INSERT` する。
     2. 対象会話が初回往復（これまで履歴0件）かつタイトルが `'新しい会話'` の場合、今回の質問文の先頭25コードポイントを `title` に設定し、同時に `updated_at = NOW()` を `UPDATE` する（2往復目以降は `updated_at = NOW()` のみ更新）。
6. **ステップ6：`201 Created` レスポンス返却**
   * 保存された `turn` オブジェクトおよび更新された `conversation` オブジェクトをJSONで返却する。

---

## 6. 画面設計（`public/ai/v2/index.html`, `app.js`） (`DES-V2-06`)

* **対応REQ**: `REQ-V2-03`, `REQ-V2-04`, `REQ-V2-05`, `REQ-V2-06`, `REQ-V2-07`

### 6.1 画面レイアウト構成（2ペイン構成）
* **左ペイン（会話一覧エリア）**:
  * 「＋ 新しい会話」ボタン（押下で新規会話作成APIを呼び出し、即座に空の対話画面へ切替）。
  * 会話スレッド一覧リスト（更新日時降順・最大20件）。選択中の会話にはアクティブ状態（CSSクラス `.active`）を付与。
  * 会話が0件の場合は「保存された会話はありません」を正常表示。
* **右ペイン（対話・入力エリア）**:
  * 選択中の会話タイトルヘッダ。
  * メッセージ履歴表示領域（最大20往復を上から古い順→新しい順でチャット風に描画。0往復時は「質問を入力して会話を始めましょう」を表示）。
  * 質問入力フォーム（`<textarea>`、文字数カウンタ表示、送信ボタン）。
  * ステータスメッセージ表示領域（エラー・読み込み中案内）。

### 6.2 フロントエンド状態管理とセキュリティ制御
* **初期ロード・リロード復元 (`REQ-V2-05`)**:
  * ページ読み込み時に `GET /api/ai/v2/conversations` を実行する。
  * 会話一覧が存在する場合、一覧を描画する。
  * **【要確認-03】**: リロード直後は「一覧の先頭（最新）の会話を自動選択して履歴を開く」か「未選択状態（新規質問入力時に自動で新規会話作成）とするか」について、実装時は利便性と `WISH-V2-03`（「選んで再開」）の双方を満たすため、**一覧を表示したうえで先頭の会話を初期選択（または未選択状態からクリック選択で即復元）**とする（※詳細な初期選択挙動は要確認事項参照）。
* **新規会話未選択状態での初回送信**:
  * もし会話が1件も選択されていない状態でユーザーが質問を送信した場合、フロントエンドが自動的に `POST /api/ai/v2/conversations` で新規会話を作成した直後に `POST /api/ai/v2/conversations/:id/turns` を呼び出し、シームレスに会話を開始できるようにする。
* **XSS対策（安全なDOM構築）**:
  * 会話タイトル、ユーザー質問、AI回答、日時のすべてにおいて `element.textContent` を使用し、`innerHTML` への文字列埋め込みを禁止する。
* **非同期通信中のロックとタイムアウト (`REQ-V2-06`, `REQ-V2-07`)**:
  * 一覧取得・履歴切替・質問送信の通信中は、入力欄・送信ボタン・会話切替ボタンを `disabled = true` / `aria-busy="true"` に設定する。
  * 質問送信の `fetch` には `AbortController` で **45秒タイムアウト** を設定し、自動再送は行わない。
  * 成功時は入力欄を空にし、受信した `turn` を画面末尾に追加（最大20往復超過時は先頭を削除）して一覧の順序を更新する。失敗時は入力欄の文字を保持する。
  * `finally` 節で必ずロック状態とビジー表示を解除する。

---

## 7. 失敗時および公開停止時の動作設計 (`DES-V2-07`)

* **対応REQ**: `REQ-V2-07`, `REQ-V2-09`, `REQ-V2-10`

| 事象・条件 | HTTPステータス | サーバー側の動作 | フロントエンド（画面）の動作 |
| :--- | :---: | :--- | :--- |
| **`GEMINI_API_KEY` 未設定**（公開停止ガード） | `503 Service Unavailable` | 画面ルート・全APIの先頭で即座に503を返却。DBやGeminiへ一切接続しない。 | 「現在AI機能は停止中です（設定未完了）」を表示し、入力フォームを非活性のまま維持する。 |
| **入力バリデーション違反**（空文字・2,001文字超・不正ID） | `400 Bad Request` | GeminiやDB更新を行わずエラーJSONを返却。 | 送信前チェック（または400応答受信時）にエラー案内を表示。入力テキストは保持。 |
| **存在しない会話ID指定** | `404 Not Found` | `CONVERSATION_NOT_FOUND` を返却。 | 「指定された会話が見つかりません」を表示し、会話一覧を再取得する。 |
| **Gemini API タイムアウト**（30秒超過） | `504 Gateway Timeout` | `AbortController` で通信を中断。DBへの往復保存は行わない。 | 「AIの応答がタイムアウトしました。時間をおいて再送信してください」を表示。**入力テキストは保持**。 |
| **Gemini API エラー / 空応答** | `500` / `502` | 生例外を隠蔽し安全なエラーJSONを返却。DB保存は行わない。 | 「AI回答の生成中にエラーが発生しました」を表示。**入力テキストは保持**。 |
| **ブラウザ側タイムアウト（45秒） / 通信断 / 不正JSON応答** | -（ネットワーク例外） | - | `catch` で捕捉して通信エラーを表示。**入力テキストは保持**し、`finally` で操作制限を解除。 |