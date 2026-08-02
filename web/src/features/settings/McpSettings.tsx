import { useState, type FormEvent } from 'react'

import {
  useHealth,
  useIssueToken,
  useRevokeToken,
  useTokens,
} from '../../data/query-hooks'
import type { IssuedAccessToken } from '../../data/project-repository'
import { webRuntimeConfig } from '../../app/runtime-config'

function displayTime(value: string | null): string {
  return value === null ? '从未' : new Date(value).toLocaleString()
}

export function McpSettings() {
  const health = useHealth()
  const tokens = useTokens()
  const issue = useIssueToken()
  const revoke = useRevokeToken()
  const [name, setName] = useState('')
  const [issued, setIssued] = useState<IssuedAccessToken | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const mcpUrl = webRuntimeConfig.mcpUrl

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('请输入令牌名称。')
      return
    }
    setError('')
    setStatus('')
    try {
      const result = await issue.mutateAsync(trimmed)
      setIssued(result)
      setName('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '签发失败。')
    }
  }

  async function revokeToken(tokenId: string, version: number) {
    if (!window.confirm('确认撤销此令牌？现有客户端将立即失去访问权限。')) {
      return
    }
    setError('')
    try {
      await revoke.mutateAsync({ tokenId, version })
      setStatus('令牌已撤销。')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '撤销失败。')
    }
  }

  return (
    <section
      aria-labelledby="mcp-settings-title"
      className="settings-card settings-card--wide"
    >
      <header>
        <h3 id="mcp-settings-title">连接与令牌</h3>
        <p>本机 Streamable HTTP 端点和访问令牌。令牌明文不会持久化。</p>
      </header>
      <dl className="settings-facts settings-facts--inline">
        <div>
          <dt>服务健康</dt>
          <dd>{health.isPending
            ? '检查中'
            : health.data?.status === 'ok'
              ? '正常'
              : '不可用'}</dd>
        </div>
        <div><dt>数据库</dt><dd>{health.data?.database ?? '未知'}</dd></div>
        <div><dt>HTTP 端点</dt><dd><code>{mcpUrl}</code></dd></div>
      </dl>

      <form className="settings-token-form" onSubmit={(event) => void submit(event)}>
        <label>
          令牌名称
          <input
            maxLength={200}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </label>
        <button
          className="button button--primary"
          disabled={issue.isPending}
          type="submit"
        >
          签发令牌
        </button>
      </form>

      {issued && (
        <div className="settings-secret" role="alert">
          <strong>令牌明文仅显示一次，请立即复制并安全保存。</strong>
          <code>{issued.token}</code>
          <div className="settings-actions">
            <button
              className="button button--secondary"
              onClick={() => void navigator.clipboard.writeText(issued.token)}
              type="button"
            >
              复制令牌
            </button>
            <button
              className="button button--ghost"
              onClick={() => setIssued(null)}
              type="button"
            >
              我已保存，隐藏令牌
            </button>
          </div>
        </div>
      )}

      <details aria-label="已签发令牌" className="settings-disclosure">
        <summary>
          <span>已签发令牌</span>
          <small>{tokens.data?.length ?? 0} 个</small>
        </summary>
        <div className="settings-token-list" aria-label="访问令牌">
          {tokens.data?.length === 0 && <p>尚未签发访问令牌。</p>}
          {tokens.data?.map((token) => (
            <article key={token.id}>
              <div>
                <strong>{token.name}</strong>
                <small>
                  创建于 {displayTime(token.createdAt)} · 最近使用 {
                    displayTime(token.lastUsedAt)
                  }
                </small>
              </div>
              {token.revokedAt
                ? <span>已撤销</span>
                : (
                    <button
                      className="button button--ghost"
                      disabled={revoke.isPending}
                      onClick={() => void revokeToken(token.id, token.version)}
                      type="button"
                    >
                      撤销
                    </button>
                  )}
            </article>
          ))}
        </div>
      </details>
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
