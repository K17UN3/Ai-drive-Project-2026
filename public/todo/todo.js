class TodoApi {
  constructor(baseUrl = '/api/v1/todos') {
    this.baseUrl = baseUrl;
  }

  async list() {
    const res = await fetch(this.baseUrl);
    const json = await res.json();
    if (!res.ok) throw json;
    return json.data;
  }

  async create(title) {
    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    const json = await res.json();
    if (!res.ok) throw json;
    return json.data;
  }

  async update(id, isCompleted) {
    const res = await fetch(`${this.baseUrl}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isCompleted }),
    });
    const json = await res.json();
    if (!res.ok) throw json;
    return json.data;
  }

  async delete(id) {
    const res = await fetch(`${this.baseUrl}/${id}`, {
      method: 'DELETE',
    });
    // 204 No Content の場合は json 解析を行わずにリターン
    if (res.status === 204) return;
    const json = await res.json();
    if (!res.ok) throw json;
  }
}

// 画面制御 DOM 操作処理
document.addEventListener('DOMContentLoaded', () => {
  const api = new TodoApi();

  const form = document.getElementById('todo-form');
  const input = document.getElementById('todo-title');
  const listContainer = document.getElementById('todo-list');
  const errorMessage = document.getElementById('error-message');

  const showError = (msg) => {
    errorMessage.textContent = msg;
    errorMessage.style.display = 'block';
  };

  const clearError = () => {
    errorMessage.textContent = '';
    errorMessage.style.display = 'none';
  };

  const renderTodos = (todos) => {
    listContainer.innerHTML = '';

    if (!todos || todos.length === 0) {
      const emptyMsg = document.createElement('p');
      emptyMsg.className = 'empty-msg';
      emptyMsg.textContent = 'TODOがありません';
      listContainer.appendChild(emptyMsg);
      return;
    }

    const ul = document.createElement('ul');
    ul.className = 'todo-items';

    todos.forEach((todo) => {
      const li = document.createElement('li');
      li.className = todo.isCompleted ? 'todo-item completed' : 'todo-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = todo.isCompleted;
      checkbox.addEventListener('change', async () => {
        try {
          clearError();
          await api.update(todo.id, checkbox.checked);
          await fetchAndRender();
        } catch (err) {
          showError(err.message || '更新に失敗しました');
          checkbox.checked = !checkbox.checked; // 元に戻す
        }
      });

      const titleSpan = document.createElement('span');
      titleSpan.className = 'title';
      titleSpan.textContent = todo.title; // XSS対策: textContent で挿入

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn-delete';
      deleteBtn.textContent = '削除';
      deleteBtn.addEventListener('click', async () => {
        try {
          clearError();
          await api.delete(todo.id);
          await fetchAndRender();
        } catch (err) {
          showError(err.message || '削除に失敗しました');
        }
      });

      li.appendChild(checkbox);
      li.appendChild(titleSpan);
      li.appendChild(deleteBtn);
      ul.appendChild(li);
    });

    listContainer.appendChild(ul);
  };

  const fetchAndRender = async () => {
    try {
      const todos = await api.list();
      renderTodos(todos);
    } catch (err) {
      showError(err.message || 'TODO一覧の取得に失敗しました');
    }
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();

    const title = input.value;
    try {
      await api.create(title);
      input.value = '';
      await fetchAndRender();
    } catch (err) {
      showError(err.message || '登録に失敗しました');
    }
  });

  // 初回読み込み時に一覧を取得
  fetchAndRender();
});