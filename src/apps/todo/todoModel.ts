import { pool } from '../../../db';

export interface Todo {
  id: number;
  title: string;
  isCompleted: boolean;
  createdAt: string;
}

interface DbTodoRow {
  id: number;
  title: string;
  is_completed: boolean;
  created_at: Date;
}

const formatTodo = (row: DbTodoRow): Todo => ({
  id: row.id,
  title: row.title,
  isCompleted: row.is_completed,
  createdAt: row.created_at.toISOString(),
});

export const todoModel = {
  // REQ-01: 一覧取得 (id 昇順)
  async findAll(): Promise<Todo[]> {
    const query = 'SELECT id, title, is_completed, created_at FROM todo_tasks ORDER BY id ASC;';
    const result = await pool.query<DbTodoRow>(query);
    return result.rows.map(formatTodo);
  },

  // REQ-02: 登録 (パラメータ化クエリ $1)
  async create(title: string): Promise<Todo> {
    const query = `
      INSERT INTO todo_tasks (title)
      VALUES ($1)
      RETURNING id, title, is_completed, created_at;
    `;
    const result = await pool.query<DbTodoRow>(query, [title]);
    return formatTodo(result.rows[0]);
  },

  // REQ-03: 完了状態部分更新 (パラメータ化クエリ $1, $2)
  async updateStatus(id: number, isCompleted: boolean): Promise<Todo | null> {
    const query = `
      UPDATE todo_tasks
      SET is_completed = $1
      WHERE id = $2
      RETURNING id, title, is_completed, created_at;
    `;
    const result = await pool.query<DbTodoRow>(query, [isCompleted, id]);
    if (result.rows.length === 0) return null;
    return formatTodo(result.rows[0]);
  },

  // REQ-04: 削除 (パラメータ化クエリ $1)
  async delete(id: number): Promise<boolean> {
    const query = 'DELETE FROM todo_tasks WHERE id = $1 RETURNING id;';
    const result = await pool.query(query, [id]);
    return result.rowCount !== null && result.rowCount > 0;
  },
};