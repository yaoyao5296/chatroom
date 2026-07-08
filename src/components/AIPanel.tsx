import { useState, useEffect, useRef } from 'react'
import { submitAITask, onAITaskUpdate, getAITasks, checkAIStatus, type AITask } from '../lib/ai'

interface Props {
  onClose: () => void
}

export default function AIPanel({ onClose }: Props) {
  const [input, setInput] = useState('')
  const [aiOnline, setAiOnline] = useState<boolean | null>(null)
  const [tasks, setTasks] = useState<AITask[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const tasksEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    checkAIStatus().then((r) => setAiOnline(r.online))
    setTasks(getAITasks())
    const unsub = onAITaskUpdate((t) => {
      setTasks((prev) => {
        const idx = prev.findIndex((p) => p.taskId === t.taskId)
        if (idx >= 0) {
          const copy = [...prev]
          copy[idx] = { ...copy[idx], ...t }
          return copy
        }
        return [...prev, t]
      })
    })
    return unsub
  }, [])

  useEffect(() => {
    tasksEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [tasks])

  const handleSubmit = async () => {
    const task = input.trim()
    if (!task || submitting) return
    setSubmitting(true)
    setError('')
    setInput('')
    const result = await submitAITask({ task, source: 'panel' })
    if (!result.success) {
      setError(result.error || '提交失败')
    }
    setSubmitting(false)
  }

  const statusIcon = (s: string) => {
    switch (s) {
      case 'pending': return '⏳'
      case 'running': return '▶️'
      case 'completed': return '✅'
      case 'failed': return '❌'
      case 'stopped': return '⏹'
      default: return '❓'
    }
  }

  const statusLabel = (s: string) => {
    switch (s) {
      case 'pending': return '等待中'
      case 'running': return '执行中'
      case 'completed': return '已完成'
      case 'failed': return '失败'
      case 'stopped': return '已停止'
      default: return s
    }
  }

  return (
    <div className="ai-panel">
      <div className="ai-panel-header">
        <h3>屿岸</h3>
        <div className="ai-panel-header-right">
          <span className={`ai-status-dot ${aiOnline ? 'online' : aiOnline === false ? 'offline' : 'checking'}`} />
          <span className="ai-status-text">
            {aiOnline === null ? '检测中...' : aiOnline ? '在线' : '离线'}
          </span>
          <button className="ai-close-btn" onClick={onClose}>✕</button>
        </div>
      </div>

      <div className="ai-panel-tasks">
        {tasks.length === 0 && (
          <div className="ai-empty">
            <p>输入你想让 AI 帮你做的事情</p>
            <p className="ai-examples">
              例如：帮我搜索今日新闻、查看某网站价格、填写表单等
            </p>
          </div>
        )}
        {tasks.map((t) => (
          <div key={t.taskId} className={`ai-task-card ${t.status}`}>
            <div className="ai-task-header">
              <span className="ai-task-icon">{statusIcon(t.status)}</span>
              <span className="ai-task-status">{statusLabel(t.status)}</span>
              <span className="ai-task-id">#{t.taskId}</span>
            </div>
            <div className="ai-task-body">{t.task}</div>
            {t.result && (
              <div className="ai-task-result">
                <strong>结果：</strong>
                {t.result.length > 300 ? t.result.slice(0, 300) + '...' : t.result}
              </div>
            )}
            {t.error && <div className="ai-task-error">错误：{t.error}</div>}
          </div>
        ))}
        <div ref={tasksEndRef} />
      </div>

      {error && <div className="ai-error">{error}</div>}

      <div className="ai-panel-input">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="输入想让 AI 完成的任务..."
          disabled={submitting}
        />
        <button onClick={handleSubmit} disabled={submitting || !input.trim()}>
          {submitting ? '...' : '发送'}
        </button>
      </div>
    </div>
  )
}