import { Request, Response } from 'express';
import { todoModel } from './todoModel';

export const todoController = {
  // 画面レンダリングハンドラ (/todo)
  renderPage(req: Request, res: Response) {
    res.render('todo/index');
  },

  // REQ-01: GET /api/v1/todos
  async getTodos(req: Request, res: Response) {
    try {
      const todos = await todoModel.findAll();
      res.status(200).json({ status: 'success', data: todos });
    } catch (err) {
      console.error('Error in getTodos:', err);
      res.status(500).json({
        status: 'error',
        code: 'INTERNAL_ERROR',
        message: 'データベースエラーが発生しました',
        details: [],
      });
    }
  },

  // REQ-02: POST /api/v1/todos
  async createTodo(req: Request, res: Response) {
    try {
      const { title } = req.body;

      if (typeof title !== 'string') {
        return res.status(400).json({
          status: 'error',
          code: 'BAD_REQUEST',
          message: 'タイトルは文字列である必要があります',
          details: [],
        });
      }

      const trimmedTitle = title.trim();

      if (trimmedTitle.length < 1 || trimmedTitle.length > 100) {
        return res.status(422).json({
          status: 'error',
          code: 'VALIDATION_ERROR',
          message: 'タイトルは1文字以上100文字以内で入力してください',
          details: [],
        });
      }

      const newTodo = await todoModel.create(trimmedTitle);
      res.status(201).json({ status: 'success', data: newTodo });
    } catch (err) {
      console.error('Error in createTodo:', err);
      res.status(500).json({
        status: 'error',
        code: 'INTERNAL_ERROR',
        message: 'データベースエラーが発生しました',
        details: [],
      });
    }
  },

  // REQ-03: PATCH /api/v1/todos/:id
  async updateTodoStatus(req: Request, res: Response) {
    try {
      const id = Number(req.params.id);
      const { isCompleted } = req.body;

      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({
          status: 'error',
          code: 'BAD_REQUEST',
          message: '不正なIDです',
          details: [],
        });
      }

      if (typeof isCompleted !== 'boolean') {
        return res.status(400).json({
          status: 'error',
          code: 'BAD_REQUEST',
          message: 'isCompleted は真偽値 (true/false) で指定してください',
          details: [],
        });
      }

      const updatedTodo = await todoModel.updateStatus(id, isCompleted);

      if (!updatedTodo) {
        return res.status(404).json({
          status: 'error',
          code: 'NOT_FOUND',
          message: '指定されたTODOが見つかりません',
          details: [],
        });
      }

      res.status(200).json({ status: 'success', data: updatedTodo });
    } catch (err) {
      console.error('Error in updateTodoStatus:', err);
      res.status(500).json({
        status: 'error',
        code: 'INTERNAL_ERROR',
        message: 'データベースエラーが発生しました',
        details: [],
      });
    }
  },

  // REQ-04: DELETE /api/v1/todos/:id
  async deleteTodo(req: Request, res: Response) {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({
          status: 'error',
          code: 'BAD_REQUEST',
          message: '不正なIDです',
          details: [],
        });
      }

      const deleted = await todoModel.delete(id);

      if (!deleted) {
        return res.status(404).json({
          status: 'error',
          code: 'NOT_FOUND',
          message: '指定されたTODOが見つかりません',
          details: [],
        });
      }

      res.status(204).send();
    } catch (err) {
      console.error('Error in deleteTodo:', err);
      res.status(500).json({
        status: 'error',
        code: 'INTERNAL_ERROR',
        message: 'データベースエラーが発生しました',
        details: [],
      });
    }
  },
};