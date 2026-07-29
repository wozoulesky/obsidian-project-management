import { useState, type ChangeEvent } from 'react'

import {
  useCreateBackup,
  useImportData,
  useProjectRepository,
  useRestoreBackup,
} from '../../data/query-hooks'

const maxImportBytes = 25 * 1024 * 1024

function message(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请重试。'
}

function downloadJson(value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `project-os-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function DataSettings() {
  const { repository } = useProjectRepository()
  const createBackup = useCreateBackup()
  const restoreBackup = useRestoreBackup()
  const importData = useImportData()
  const [backupFilename, setBackupFilename] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  async function create() {
    setStatus('')
    setError('')
    try {
      const backup = await createBackup.mutateAsync(undefined)
      setBackupFilename(backup.filename)
      setStatus(`备份已创建：${backup.filename}`)
    } catch (caught) {
      setError(`创建备份失败：${message(caught)}`)
    }
  }

  async function restore() {
    if (
      backupFilename === ''
      || !window.confirm(`确认恢复备份 ${backupFilename}？当前数据将被替换。`)
    ) return
    setStatus('')
    setError('')
    try {
      await restoreBackup.mutateAsync(backupFilename)
      setStatus('备份已恢复，请刷新页面确认数据。')
    } catch (caught) {
      setError(`恢复失败：${message(caught)}`)
    }
  }

  async function exportData() {
    setStatus('')
    setError('')
    try {
      downloadJson(await repository.exportData())
      setStatus('JSON 导出已开始。')
    } catch (caught) {
      setError(`导出失败：${message(caught)}`)
    }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setStatus('')
    setError('')
    if (file.size > maxImportBytes) {
      setError('导入文件不能超过 25 MiB。')
      return
    }
    if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
      setError('请选择 JSON 文件。')
      return
    }
    try {
      const result = await importData.mutateAsync(file)
      const counts = result.counts
      setStatus(
        `导入完成：负责人 ${counts.actors}，项目 ${counts.projects}，`
        + `成员关系 ${counts.projectMembers}，任务 ${counts.tasks}，`
        + `需求 ${counts.requirements}，缺陷 ${counts.defects}。`,
      )
    } catch (caught) {
      setError(`导入失败：${message(caught)}`)
    }
  }

  return (
    <section aria-labelledby="data-settings-title" className="settings-card">
      <header>
        <h2 id="data-settings-title">数据</h2>
        <p>创建可恢复的 SQLite 备份，或导入导出不含访问令牌的 JSON。</p>
      </header>
      <div className="settings-actions settings-actions--wrap">
        <button
          className="button button--secondary"
          disabled={createBackup.isPending}
          onClick={() => void create()}
          type="button"
        >
          创建备份
        </button>
        <button
          className="button button--secondary"
          disabled={backupFilename === '' || restoreBackup.isPending}
          onClick={() => void restore()}
          type="button"
        >
          恢复此备份
        </button>
        <button
          className="button button--secondary"
          onClick={() => void exportData()}
          type="button"
        >
          导出 JSON
        </button>
        <label className="button button--secondary settings-file">
          导入 JSON
          <input
            accept="application/json,.json"
            aria-label="选择要导入的 JSON 文件"
            onChange={(event) => void importFile(event)}
            type="file"
          />
        </label>
      </div>
      {backupFilename && (
        <p className="settings-code">
          本次创建：<code>{backupFilename}</code>
        </p>
      )}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
