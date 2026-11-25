import { Router } from 'express';
import { chatController } from './chatController';

// 画面表示用ルーター (app.use('/chat', chatPageRouter))
export const chatPageRouter = Router();
chatPageRouter.get('/', chatController.renderPage);

// API用ルーター (app.use('/api/chat', chatApiRouter))
export const chatApiRouter = Router();
chatApiRouter.post('/join', chatController.join);
chatApiRouter.get('/sync', chatController.sync);
chatApiRouter.post('/messages', chatController.postMessage);
chatApiRouter.post('/leave', chatController.leave);