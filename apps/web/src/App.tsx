import { useState, useCallback, type FormEvent, type KeyboardEvent } from 'react'
import './App.css'

type Todo = { id: string; text: string; done: boolean }

function App() {
  const [draft, setDraft] = useState('')
  const [todos, setTodos] = useState<Todo[]>([])

  const addTodo = useCallback(() => {
    const text = draft.trim()
    if (!text) return
    setTodos((prev) => [...prev, { id: crypto.randomUUID(), text, done: false }])
    setDraft('')
  }, [draft])

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

  const doneCount = todos.filter((t) => t.done).length

  return (
    <div className="app">
      <header className="header">
        <h1 className="title">待办</h1>
        <p className="subtitle">单页清单 · 按 harness/spec.md 验收</p>
      </header>

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

      <ul className="list" aria-label="任务列表">
        {todos.length === 0 ? (
          <li className="empty">暂无任务，添加一条开始吧。</li>
        ) : (
          todos.map((t) => (
            <li key={t.id} className={`row ${t.done ? 'row-done' : ''}`}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={t.done}
                  onChange={() => toggle(t.id)}
                />
                <span className="label-text">{t.text}</span>
              </label>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => remove(t.id)}
              >
                删除
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}

export default App
