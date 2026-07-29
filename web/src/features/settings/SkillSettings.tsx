import {
  useEffect,
  useState,
} from 'react'

import { useProjectRepository } from '../../data/query-hooks'
import type {
  SkillConfigClient,
  SkillConfigSnippet,
} from '../../data/project-repository'

const clients = [
  'codex',
  'claude-code',
  'kimi-code',
] as const satisfies readonly SkillConfigClient[]

const clientLabels: Record<SkillConfigClient, string> = {
  codex: 'Codex',
  'claude-code': 'Claude Code',
  'kimi-code': 'Kimi Code',
}

export function SkillSettings() {
  const { repository } = useProjectRepository()
  const [snippets, setSnippets] = useState<
    Partial<Record<SkillConfigClient, SkillConfigSnippet>>
  >({})
  const [snippetError, setSnippetError] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void Promise.allSettled(
      clients.map((client) => repository.getSkillConfigSnippet(client)),
    ).then((results) => {
      if (!active) return
      const loaded: Partial<
        Record<SkillConfigClient, SkillConfigSnippet>
      > = {}
      const failures: string[] = []
      for (const result of results) {
        if (result.status === 'fulfilled') {
          loaded[result.value.client] = result.value
        } else {
          failures.push(
            result.reason instanceof Error
              ? result.reason.message
              : '配置读取失败',
          )
        }
      }
      setSnippets(loaded)
      setSnippetError(
        failures.length === 0
          ? ''
          : `部分客户端配置读取失败：${failures[0]}`,
      )
    })
    return () => {
      active = false
    }
  }, [repository])

  async function copy(client: SkillConfigClient) {
    setError('')
    const snippet = snippets[client]?.snippet
    if (snippet === undefined) {
      setError(`${clientLabels[client]} 配置尚未加载。`)
      return
    }
    try {
      await navigator.clipboard.writeText(snippet)
      setStatus(`${clientLabels[client]} 配置已复制。`)
    } catch {
      setError('无法访问剪贴板，请手动复制配置。')
    }
  }

  async function download() {
    setStatus('')
    setError('')
    try {
      const blob = await repository.downloadSkill()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'project-os.zip'
      anchor.click()
      URL.revokeObjectURL(url)
      setStatus('Agent Skill 下载已开始。')
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Agent Skill 下载失败，请稍后重试。',
      )
    }
  }

  return (
    <section
      aria-labelledby="skill-settings-title"
      className="settings-card settings-card--wide"
    >
      <header>
        <h2 id="skill-settings-title">Agent Skills</h2>
        <p>复制本机 stdio 连接片段，或下载可安装的完整 Skill ZIP。</p>
      </header>
      <div className="settings-snippets">
        {clients.map((client) => (
          <article key={client}>
            <h3>{clientLabels[client]}</h3>
            <pre tabIndex={0}><code>
              {snippets[client]?.snippet ?? '正在读取服务端配置…'}
            </code></pre>
            <button
              className="button button--secondary"
              disabled={snippets[client] === undefined}
              onClick={() => void copy(client)}
              type="button"
            >
              复制 {clientLabels[client]} 配置
            </button>
          </article>
        ))}
      </div>
      <div className="settings-actions">
        <button
          className="button button--primary"
          onClick={() => void download()}
          type="button"
        >
          下载 Project OS Skill
        </button>
        {status && <p role="status">{status}</p>}
        {snippetError && <p role="alert">{snippetError}</p>}
        {error && <p role="alert">{error}</p>}
      </div>
    </section>
  )
}
