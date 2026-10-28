import { Router } from 'express';
import { todoController } from './todoController';

export const todoRouter = Router();

// REST API ルート (REQ-01 ～ REQ-04)
todoRouter.get('/api/v1/todos', todoController.getTodos);
todoRouter.post('/api/v1/todos', todoController.createTodo);
todoRouter.patch('/api/v1/todos/:id', todoController.updateTodoStatus);
todoRouter.delete('/api/v1/todos/:id', todoController.deleteTodo);

// 画面表示ルート (/todo および /todo/)
todoRouter.get('/todo', todoController.renderPage);
todoRouter.get('/todo/', todoController.renderPage);