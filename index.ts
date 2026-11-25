import express from 'express';
import path from 'path';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { todoRouter } from './src/apps/todo/todoRouter';
import { aiRouter } from './src/apps/ai/aiRouter';
import { aiV2Router } from './src/apps/ai/v2/aiV2Router';
import { chatPageRouter, chatApiRouter } from './src/apps/chat/chatRouter';

const app = express();
const PORT = process.env.PORT || 3000;

// EJS View Engine 設定
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ミドルウェア設定 (DoS防止のためボディサイズ制限を10kbに設定)
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- 既存ルート (影響を与えないよう維持) ---
app.get('/', (req, res) => {
  res.render('index');
});

app.get('/api/db-check', (req, res) => {
  res.json({ status: 'ok' });
});

// --- AI静的画面へのダイレクトルート (GET /ai) ---
app.get('/ai', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ai', 'index.html'));
});

// --- AI質問機能 V2 画面ルート (GET /ai/v2, GET /ai/v2/) ---
app.get(['/ai/v2', '/ai/v2/'], (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res
      .status(503)
      .type('html')
      .send(
        '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>AI質問機能 V2 - 停止中</title></head><body style="font-family:sans-serif;max-width:640px;margin:40px auto;padding:16px;"><h1>現在AI質問機能は停止中です</h1><p>APIキーが設定されていないため、V2機能を利用できません。</p><p><a href="/">TOPページへ戻る</a></p></body></html>'
      );
  }
  return res.sendFile(path.join(__dirname, 'public', 'ai', 'v2', 'index.html'));
});

// --- TODO機能のルーティング登録 ---
app.use('/', todoRouter);

// --- AI質問機能のルーティング登録 ---
app.use('/ai', aiRouter);       // GET /ai (画面表示)
app.use('/api/ai', aiRouter);   // POST /api/ai/ask, GET /api/ai/history (API)

// --- AI質問機能 V2 APIルーティング登録 ---
app.use('/api/ai/v2', aiV2Router);

// --- チャット機能 画面ルーティング登録 ---
app.use('/chat', chatPageRouter);
app.use('/api/chat', chatApiRouter);

// --- HTTPサーバー & Socket.IO 初期化 (既存の app.listen を置換) ---
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