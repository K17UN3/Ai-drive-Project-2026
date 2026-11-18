import { Router } from 'express';
import { aiV2Controller } from './aiV2Controller';

export const aiV2Router = Router();

// 会話一覧取得・新規作成
aiV2Router.get('/conversations', aiV2Controller.getConversations);
aiV2Router.post('/conversations', aiV2Controller.createConversation);

// 指定会話の往復履歴取得・文脈付き質問送信
aiV2Router.get('/conversations/:id/turns', aiV2Controller.getConversationTurns);
aiV2Router.post('/conversations/:id/turns', aiV2Controller.postTurn);