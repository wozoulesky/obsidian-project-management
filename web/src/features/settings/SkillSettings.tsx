import { useState } from 'react'

import { useProjectRepository } from '../../data/query-hooks'

const snippets = {
  'Codex': `[mcp_servers.project-os]
url = "http://127.0.0.1:4310/mcp"`,
  'Claude Code': 'claude mcp add --transport http project-os http://127.0.0.1:4310/mcp',
  'Kimi Code': `{
  "mcpServers": {
    "project-os": { "url": "http://127.0.0.1:4310/mcp" }
  }
}`,
} as const

export function SkillSettings() {
  const { repository } = useProjectRepository()
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  async function copy(client: keyof typeof snippets) {
    setError('')
    try {
      await navigator.clipboard.writeText(snippets[client])
      setStatus(`${client} 配置已复制。`)
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
      const detail = caught instanceof Error ? caught.message : ''
      setError(
        detail.includes('尚未安装')
          ? detail
          : 'Agent Skill 尚未安装；服务端下载能力将在 Task 04.5 提供。',
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
        <p>复制客户端连接片段，或在服务端能力安装后下载完整 Skill ZIP。</p>
      </header>
      <div className="settings-snippets">
        {(Object.keys(snippets) as (keyof typeof snippets)[]).map((client) => (
          <article key={client}>
            <h3>{client}</h3>
            <pre><code>{snippets[client]}</code></pre>
            <button
              className="button button--secondary"
              onClick={() => void copy(client)}
              type="button"
            >
              复制 {client} 配置
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
        {error && <p role="alert">{error}</p>}
      </div>
    </section>
  )
}
