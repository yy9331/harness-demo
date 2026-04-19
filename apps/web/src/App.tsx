import { useState, useCallback, useEffect, type FormEvent, type KeyboardEvent } from 'react'
import './App.css'

type Category = 'inbox' | 'work' | 'life' | 'study'

const categoryLabels: Record<Category, string> = {
  inbox: '收件箱',
  work: '工作',
  life: '生活',
  study: '学习',
}

type Todo = {
  id: string
  text: string
  done: boolean
  archived: boolean
  category: Category
  dueDate: string | null // YYYY-MM-DD format
  createdAt: string
}

type ViewMode = 'active' | 'archived'

function App() {
  const [draft, setDraft] = useState('')
  const [todos, setTodos] = useState<Todo[]>([])
  const [viewMode, setViewMode] = useState<ViewMode>('active')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [defaultCategory, setDefaultCategory] = useState<Category>('inbox')
  const [defaultDueDate, setDefaultDueDate] = useState<string>('')

  const addTodo = useCallback(() => {
    const text = draft.trim()
    if (!text) return
    const today = new Date().toISOString().split('T')[0]
    setTodos((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        text,
        done: false,
        archived: false,
        category: defaultCategory,
        dueDate: defaultDueDate || null,
        createdAt: today,
      },
    ])
    setDraft('')
    setDefaultDueDate('')
  }, [draft, defaultCategory, defaultDueDate])

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    addTodo()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addTodo()
    }
  }

  const toggle = (id: string) => {
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    )
  }

  const remove = (id: string) => {
    setTodos((prev) => prev.filter((t) => t.id !== id))
  }

  const clearDone = () => {
    setTodos((prev) => prev.filter((t) => !t.done))
  }

  const startEdit = (todo: Todo) => {
    setEditingId(todo.id)
    setEditText(todo.text)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditText('')
  }

  const saveEdit = (id: string) => {
    const text = editText.trim()
    if (!text) return
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, text } : t)),
    )
    setEditingId(null)
    setEditText('')
  }

  const toggleArchive = (id: string) => {
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, archived: !t.archived } : t)),
    )
  }

  const restoreArchive = (id: string) => {
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, archived: false } : t)),
    )
  }

  const deleteArchived = (id: string) => {
    setTodos((prev) => prev.filter((t) => t.id !== id))
  }

  const getDateStatus = (dueDate: string | null) => {
    if (!dueDate) return null
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const due = new Date(dueDate)
    due.setHours(0, 0, 0, 0)

    if (due.getTime() === today.getTime()) return 'today'
    if (due.getTime() < today.getTime()) return 'overdue'
    return 'future'
  }

  // 持久化到 localStorage
  useEffect(() => {
    const saved = localStorage.getItem('todos-harness')
    if (saved) {
      try {
        setTodos(JSON.parse(saved))
      } catch (e) {
        console.error('Failed to load todos', e)
      }
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('todos-harness', JSON.stringify(todos))
  }, [todos])

  const filteredTodos = todos.filter((t) =>
    viewMode === 'active' ? !t.archived : t.archived,
  )
  const doneCount = filteredTodos.filter((t) => t.done).length

  return (
    <div className="app">
      <header className="header">
        <h1 className="title">待办</h1>
        <p className="subtitle">单页清单 · 按 harness/spec.md 验收</p>

        <div className="view-switch">
          <button
            type="button"
            className={`btn btn-ghost btn-sm ${viewMode === 'active' ? 'active' : ''}`}
            onClick={() => setViewMode('active')}
          >
            活跃
          </button>
          <button
            type="button"
            className={`btn btn-ghost btn-sm ${viewMode === 'archived' ? 'active' : ''}`}
            onClick={() => setViewMode('archived')}
          >
            归档
          </button>
        </div>
      </header>

      <div className="add-form-group">
        <form className="composer" onSubmit={onSubmit}>
          <label htmlFor="todo-input" className="sr-only">
            新任务
          </label>
          <input
            id="todo-input"
            className="input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="输入任务，按 Enter 或点添加"
            autoComplete="off"
          />
          <button type="submit" className="btn btn-primary">
            添加
          </button>
        </form>

        <div className="options-row">
          <div className="option-group">
            <label htmlFor="category-select" className="option-label">
              分类
            </label>
            <select
              id="category-select"
              className="input input-sm"
              value={defaultCategory}
              onChange={(e) => setDefaultCategory(e.target.value as Category)}
            >
              {(Object.entries(categoryLabels) as [Category, string][]).map(
                ([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ),
              )}
            </select>
          </div>
          <div className="option-group">
            <label htmlFor="due-date" className="option-label">
              截止日期
            </label>
            <input
              id="due-date"
              type="date"
              className="input input-sm"
              value={defaultDueDate}
              onChange={(e) => setDefaultDueDate(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
            />
          </div>
        </div>
      </div>

      <section className="toolbar" aria-label="批量操作">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={clearDone}
          disabled={doneCount === 0}
        >
          清空已完成
        </button>
        {doneCount > 0 && (
          <span className="meta">已完成 {doneCount} 条</span>
        )}
      </section>

      {filteredTodos.length === 0 ? (
        <div className="empty" role="status">
          {viewMode === 'active' ? '暂无任务，添加一条开始吧。' : '归档区为空'}
        </div>
      ) : (
        <ul className="list" aria-label={viewMode === 'active' ? '任务列表' : '归档列表'}>
          {filteredTodos.map((t) => {
            const dateStatus = getDateStatus(t.dueDate)
            const isEditing = editingId === t.id

            return (
              <li
                key={t.id}
                className={`row ${t.done ? 'row-done' : ''} ${isEditing ? 'row-editing' : ''}`}
              >
                {isEditing ? (
                  <div className="edit-container">
                    <input
                      autoFocus
                      className="input edit-input"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit(t.id)
                        if (e.key === 'Escape') cancelEdit()
                      }}
                    />
                    <div className="edit-actions">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => saveEdit(t.id)}
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={cancelEdit}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="todo-content">
                      <label className="check">
                        {viewMode === 'active' && (
                          <input
                            type="checkbox"
                            checked={t.done}
                            onChange={() => toggle(t.id)}
                          />
                        )}
                        <div className="todo-text-wrapper">
                          <span className="label-text">{t.text}</span>
                          <div className="todo-meta">
                            <span className="category-tag">
                              {categoryLabels[t.category]}
                            </span>
                            {t.dueDate && (
                              <span
                                className={`due-tag due-${dateStatus}`}
                              >
                                {dateStatus === 'today'
                                  ? '今天'
                                  : dateStatus === 'overdue'
                                    ? '已过期'
                                    : t.dueDate}
                              </span>
                            )}
                          </div>
                        </div>
                      </label>
                    </div>
                    <div className="todo-actions">
                      {viewMode === 'active' && (
                        <>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => startEdit(t)}
                            aria-label={`编辑任务: ${t.text}`}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => toggleArchive(t.id)}
                            aria-label={`归档任务: ${t.text}`}
                          >
                            归档
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => remove(t.id)}
                            aria-label={`删除任务: ${t.text}`}
                          >
                            删除
                          </button>
                        </>
                      )}
                      {viewMode === 'archived' && (
                        <>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => restoreArchive(t.id)}
                          >
                            恢复
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => deleteArchived(t.id)}
                          >
                            删除
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default App
