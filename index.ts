import express from 'express';
import path from 'path';
import { todoRouter } from './src/apps/todo/todoRouter';

const app = express();
const PORT = process.env.PORT || 3000;

// EJS View Engine 設定
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ミドルウェア設定
app.use(express.json()); // POST の JSON Body パース用
app.use(express.static(path.join(__dirname, 'public')));

// --- 既存ルート (影響を与えないよう維持) ---
app.get('/', (req, res) => {
  res.send('TOP Page');
});

app.get('/api/db-check', (req, res) => {
  res.json({ status: 'ok' });
});

// --- TODO機能のルーティング登録 ---
app.use('/', todoRouter);

app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});