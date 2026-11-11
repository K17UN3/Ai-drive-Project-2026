# AI質問機能 詳細設計書 (`docs/ai/spec.md`)

## 1. システム全体像と各レイヤーの役割

本機能は、ブラウザ、Express（バックエンド）、Gemini API（外部AIサービス）、PostgreSQL（データベース）が連携して動作する。

```
[ ブラウザ (Front) ]
       │  ① POST /api/v1/ai/ask (Fetch API / JSON)
       ▼
[ Express Server (Router -> Controller -> Service -> Model) ]
       │                      │
       │ ② SDK経由呼び出し     │ ③ ログ記録 (非同期 INSERT)
       ▼                      ▼
[ Gemini API ]          [ PostgreSQL (ai_qa_logs) ]
```

* **ブラウザ (フロントエンド)**
  * TOP画面およびTODO画面上のAI質問コンポーネント（フォーム・回答エリア）のUI描画。
  * クライアントサイドでの入力バリデーション（空文字・文字数チェック）。
  * Fetch APIを用いた非同期リクエスト送信、ローディングUI（送信ボタン非活性・スピナー）の制御、回答およびエラーの画面表示。
  * **セキュリティ要件**: APIキーやDB接続情報はフロントエンドに一切送信・保持させない。
* **Express サーバー (バックエンド)**
  * リクエストの受信、デモ停止/APIキー未設定チェック、サーバサイドバリデーション。
  * Gemini APIクライアントの呼び出し、タイムアウト（30秒）監視、APIエラーハンドリング。
  * 対話ログデータ（質問・回答・ステータス・実行時間）のDB非同期記録。
  * 既存TODO APIと同様の統一JSONレスポンス構造の形成と返却。
* **Gemini API (外部AIサービス)**
  * バックエンドからの指示（プロンプト）に基づき、日本語レスポンスを生成・返却。
* **PostgreSQL (データベース)**
  * 実行履歴・品質分析用ログテーブル `ai_qa_logs` の保持。

---

## 2. ファイル構成とアーキテクチャ・各レイヤーの責務

既存の `src/apps/todo/` のディレクトリ構造およびモジュール設計を踏襲し、`src/apps/ai/` を新設する。

```
src/
└── apps/
    ├── todo/                # 既存TODO機能
    └── ai/                  # AI質問機能 (新規追加)
        ├── aiRouter.ts      # ルーティング定義 (/ai, /api/v1/ai/ask)
        ├── aiController.ts  # リクエスト/レスポンス制御・バリデーション・デモ停止判定
        ├── aiService.ts     # Gemini API連動・ビジネスロジック
        └── aiModel.ts       # ai_qa_logs テーブル操作・DBクエリ
```

* **`aiRouter.ts` (Router)**
  * 画面ルート（`GET /ai`）および API エンドポイント（`POST /api/v1/ai/ask`）と Controller メソッドのバインド。
* **`aiController.ts` (Controller)**
  * 画面レンダリング（`views/ai/index.ejs`）ハンドラーの提供。
  * リクエスト受信時、最優先で**環境変数/デモ停止チェック**を実施（未設定時は 503 を即時返却）。
  * `req.body` からのパラメータ抽出および入力型・文字数検証（AI呼び出し前のガード）。
  * `aiService` の呼び出しと例外ハンドリング（HTTPステータスコードの制御）。
  * 統一フォーマット形式（`{ status, data, code, message }`）でのレスポンス生成。
* **`aiService.ts` (Service)**
  * Google Gen AI SDK の初期化およびGemini APIの実行。
  * タイムアウト（30秒）処理およびエラーのドメイン例外化。
  * 応答受領後、`aiModel` を非同期で呼び出しログ記録を実行（DB失敗時もAI回答の返却処理は妨げない）。
* **`aiModel.ts` (Model)**
  * 共通コネクション pool (`db.ts`) を使用した `ai_qa_logs` テーブルへの SQL INSERT 処理（パラメータ化クエリ `$1, $2...` を徹底）。

---

## 3. 画面構成とステート（状態）遷移

TOP画面（`views/index.ejs`）、TODO画面（`views/todo/index.ejs`）、および独立画面（`views/ai/index.ejs`）で利用可能な「AI質問コンポーネント」を定義する。

### 画面要素
1. **質問入力フォーム**: `<textarea id="ai-question-input">`（プレースホルダー、最大文字数カウンター付）
2. **送信ボタン**: `<button id="ai-submit-btn">`（「AIに質問する」）
3. **回答表示エリア**: `<div id="ai-response-area">`（レスポンス描画用領域）
4. **ステータス・エラー表示部**: `<div id="ai-status-message">`（警告・エラーメッセージ用）

### 画面ステート（状態管理）
* **1. 初期状態 (IDLE / 履歴0件)**: 
  * フォーム入力可能、回答表示エリア (`#ai-response-area`) およびエラー表示部は**非表示 (hidden)** とする。（履歴0件は正常な初期状態扱い）
* **2. 待機状態 (LOADING)**: 
  * 送信ボタンが非活性（`disabled = true`）。
  * ボタン表示が「回答生成中...」へ変更され、スピナーアニメーションを表示。
  * テキストエリアが編集不可（`readonly`）。
* **3. 成功状態 (SUCCESS)**:
  * 待機状態解除。
  * 回答エリアの非表示解除。`element.textContent` を使用してAIが生成したテキストを出力（HTMLレンダリングを防止しXSSを対策）。
* **4. 0件・空回答状態 (EMPTY)**:
  * 待機状態解除。
  * 「回答を取得できませんでした。質問内容を少し変えて再度お試しください。」という注意文言をテキスト表示。
* **5. 失敗状態 (ERROR)**:
  * 待機状態解除。
  * エラーメッセージ表示部（`#ai-status-message`）に赤字で失敗原因（「通信エラーが発生しました」等）を表示。入力テキストは保持。

---

## 4. API詳細仕様

### 1. 画面レンダリング (`GET /ai`)
* **URL**: `/ai`
* **Method**: `GET`
* **処理**: `views/ai/index.ejs` をレンダリングして返却。

### 2. AI質問送信 (`POST /api/v1/ai/ask`)
* **URL**: `/api/v1/ai/ask`
* **Method**: `POST`
* **Content-Type**: `application/json`

#### リクエストパラメータ (Body)
```json
{
  "question": "TODOアプリの効率的な使い方を教えてください"
}
```
* `question`: string / 必須 / トリム後 1文字以上 1,000文字以内

#### 処理フロー（サーバー側実行順序）
1. **デモ停止・鍵チェック**: `GEMINI_API_KEY` 未設定時は即座に **HTTP 503** を返却。
2. **入力検証 (Validation)**: `question` の型・文字数を検証。不正時は即座に **HTTP 400/422** を返却（外部AIは呼び出さない）。
3. **外部AI呼び出し**: Gemini APIへリクエスト送信（30秒タイムアウト監視）。
4. **非同期DBログ保存**: 回答取得後、`aiModel.saveLog()` をバックグラウンド実行。
5. **レスポンス返却**: HTTP 200 OK で統一JSONフォーマットを返却。

#### レスポンス仕様

##### A. 成功時 (HTTP 200 OK)
```json
{
  "status": "success",
  "data": {
    "answer": "TODOアプリを効果的に使うには、タスクを細分化し...",
    "askedAt": "2026-11-11T05:19:00.000Z"
  }
}
```

##### B. 入力バリデーションエラー時 (HTTP 400 Bad Request / HTTP 422 Unprocessable Entity)
```json
{
  "status": "error",
  "code": "VALIDATION_ERROR",
  "message": "質問文は1文字以上1000文字以内で入力してください",
  "details": []
}
```

##### C. サービス利用不可・デモ停止時 (HTTP 503 Service Unavailable)
```json
{
  "status": "error",
  "code": "SERVICE_UNAVAILABLE",
  "message": "現在AI質問機能は利用できません。設定をご確認ください",
  "details": []
}
```

##### D. タイムアウト時 (HTTP 504 Gateway Timeout)
```json
{
  "status": "error",
  "code": "TIMEOUT_ERROR",
  "message": "AIからの応答が時間内に得られませんでした。時間を置いて再試行してください",
  "details": []
}
```

##### E. 外部API障害・サーバー内部エラー時 (HTTP 500 Internal Server Error)
```json
{
  "status": "error",
  "code": "INTERNAL_ERROR",
  "message": "AI回答の生成中にエラーが発生しました",
  "details": []
}
```

---

## 5. データベース設計 (`ai_qa_logs`)

既存のPostgreSQLデータベース内に、AIとの対話履歴および品質監視用のログテーブルを作成する。

### テーブル定義 SQL (`DDL`)
```sql
CREATE TABLE IF NOT EXISTS ai_qa_logs (
  id BIGSERIAL PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT,
  status_code VARCHAR(50) NOT NULL,
  response_time_ms INTEGER NOT NULL,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 検索・分析用のインデックス作成
CREATE INDEX IF NOT EXISTS idx_ai_qa_logs_created_at ON ai_qa_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_qa_logs_status_code ON ai_qa_logs(status_code);
```

### 各項目の定義と制約
* `id`: ログ一意識別ID（自動採番主キー）
* `question`: ユーザーが入力した質問文（`TEXT`, `NOT NULL`）
* `answer`: AIが生成した回答テキスト（`TEXT`, 失敗時は `NULL`）
* `status_code`: 処理結果コード（`SUCCESS`, `VALIDATION_ERROR`, `API_ERROR`, `TIMEOUT`）
* `response_time_ms`: API処理にかかった所要時間（ミリ秒）
* `error_message`: エラー発生時の内部メッセージ（正常時は `NULL`）
* `created_at`: ログ記録日時

### AI成功・DB失敗の切り分け（堅牢性設計）
* AI API呼び出しが成功し回答が得られた場合、DBへのログ挿入 (`aiModel`) は `catch` ブロックで囲み非同期（Background）で処理する。
* DB接続障害やテーブル不在等でログ保存が失敗した場合でも、**コンソールにエラーログを出力するのみにとどめ、ユーザーには HTTP 200 OK で AI 回答を正常返却する**。

---

## 6. ルーティングおよびミドルウェアの登録順序 (`index.ts`)

既存のルーティング・エラー処理を破壊しないよう、`index.ts` におけるミドルウェア適用順序を以下のように定義する。

```typescript
// 1. 基本ミドルウェア（JSON解析制限を10kbに明示設定してDoSを防止）
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 2. ビューエンジン設定
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 3. 既存ルート (TOP / ヘルスチェック)
app.get('/', (req, res) => { res.send('TOP Page'); });
app.get('/api/db-check', (req, res) => { res.json({ status: 'ok' }); });

// 4. 機能別ルーターの登録
app.use('/', todoRouter); // 既存 TODO ルート (/todo, /api/v1/todos 等)
app.use('/', aiRouter);   // 新規 AI ルート (/ai, /api/v1/ai/ask)

// 5. 404ハンドラー (未定義ルートへの対処)
app.use((req, res, next) => {
  res.status(404).json({
    status: 'error',
    code: 'NOT_FOUND',
    message: '指定されたエンドポイントが存在しません',
    details: []
  });
});

// 6. グローバルエラーハンドラー (例外捕捉・クラッシュ防止)
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled Error:', err);
  res.status(500).json({
    status: 'error',
    code: 'INTERNAL_ERROR',
    message: 'サーバー内部で予期せぬエラーが発生しました',
    details: []
  });
});
```

---

## 7. セキュリティ対策

1. **秘密情報（API Key）の保護**
   * APIキーはソースコード内に直書きせず、`process.env.GEMINI_API_KEY` から読み込む。
   * クライアント側（JavaScript/EJS）やAPIレスポンスにはAPIキーおよびDB接続情報を一切露出させない。
2. **XSS (Cross-Site Scripting) 対策**
   * フロントエンドでAIの回答および質問テキストを描画する際、`element.textContent` を使用し、HTMLタグとしての解釈・レンダリング（`innerHTML`）を禁止する。
3. **SQL インジェクション対策**
   * `ai_qa_logs` への挿入時、`pg` ライブラリのパラメータ化クエリ（`$1, $2, $3...`）を徹底する。
4. **ログのマスキング・限定ログ**
   * サーバーコンソールログ出力時、APIキーや受領ヘッダー等の機密情報を出力しない。

---

## 8. 通信・タイムアウト・エラーハンドリング詳細

1. **待機期限（タイムアウト制御）**
   * バックエンド側の `aiService` にて `AbortController` を実装し、呼び出し開始から **30秒** 経過した時点でリクエストを強制中断し、HTTP 504 を返却する。
2. **SDK再試行（リトライ）の無効化・制御**
   * ネットワーク障害時の無限待機を防ぐため、SDK自動再試行は無効（または0回）に設定し、バックエンドで即座にエラー判定を行う。
3. **部分成功・空回答の扱い**
   * Gemini APIからのレスポンスは得られたものの、テキスト抽出結果が空文字列（0文字）となった場合、HTTP 200 でレスポンスを返すが、`data.answer` に「回答を取得できませんでした。質問内容を変えて再度お試しください。」を挿入する。

---

## 9. Preview環境とProduction環境の運用

* **開発・Preview環境 (Local / Staging)**
  * `.env` に開発用APIキーを配置。
  * `npm run dev` (`tsx watch ./index.ts`) により動作検証。
  * ログレベルを DEBUG に設定可能。
* **Production環境 (本番)**
  * 本番サーバーの環境変数に本番用APIキーおよび `DATABASE_URL` を設定。
  * `npm run build` (`tsc`) 後、`npm run start` (`node ./dist/index.js`) で起動。
  * エラー発生時は詳細なスタックトレースをレスポンスに含めず、抽象化されたメッセージのみを返却。

---

## 10. 要件 (REQ-AI)・設計 (DES-AI)・検証方法の対応表

| 要件ID | 設計ID (DES-AI) | 設計概要 | 確認・検証方法 |
| :--- | :--- | :--- | :--- |
| **REQ-AI-F001** | **DES-AI-01** | `GET /ai` の画面提供および TOP/TODO 画面への AI 質問 UI の組み込み（第3, 4項） | ブラウザで `/`, `/todo`, `/ai` を開き、フォームおよびボタンが表示されるか確認 |
| **REQ-AI-F002** | **DES-AI-02** | `POST /api/v1/ai/ask` のエンドポイント定義と Gemini SDK による回答取得（第4項） | 有効な質問を送信し、200 OK と回答テキストが画面表示されるか確認 |
| **REQ-AI-F003** | **DES-AI-03** | フロント/バックエンドにおける空文字・1,000文字超の入力検証（第3, 4項） | 空文および1001文字以上のテキストを送信し、AIを呼び出さずに 400/422 エラーが返るか確認 |
| **REQ-AI-F004** | **DES-AI-04** | Fetch通信中のボタン非活性（disabled）およびローディング表示制御（第3項） | 通信中にボタンが非活性化し「回答生成中...」となるか視覚的に確認 |
| **REQ-AI-F005** | **DES-AI-05** | API通信障害・例外発生時の捕捉と画面へのエラーメッセージ表示（第4, 6項） | 意図的に無効なAPIキーを設定して送信し、エラーメッセージが画面表示されサーバーがクラッシュしないか確認 |
| **REQ-AI-N001** | **DES-AI-06** | `src/apps/ai/` 配下での Router/Controller/Service/Model レイヤー分離（第2項） | ディレクトリおよびコード構造が既存 TODO アプリを踏襲しているか確認 |
| **REQ-AI-N002** | **DES-AI-07** | 環境変数（`GEMINI_API_KEY`）経由での鍵読み込みとブラウザ非露出（第7項） | ソースコード内への鍵直書きやブラウザ側での鍵参照が存在しないことをコードレビューで確認 |
| **REQ-AI-N003** | **DES-AI-08** | 既存ルート（`/`, `/todo`, `/api/db-check`）の非破壊およびミドルウェア順序（第6項） | AI機能追加後も既存の全APIおよび画面が従来通り正常動作するかテストを実行 |
| **REQ-AI-N004** | **DES-AI-09** | 30秒タイマーによるタイムアウト処理と504エラー返却（第4, 8項） | 遅延処理を用いて30秒経過時に 504 Gateway Timeout が返るか確認 |
| **REQ-AI-D001** | **DES-AI-10** | 対話ログ用 `ai_qa_logs` テーブル設計およびDB失敗時の非同期安全処理（第5項） | DB挿入失敗時でもAI回答レスポンス (200 OK) が維持されるかテストで確認 |