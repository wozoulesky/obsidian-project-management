import { test, expect } from './real-runtime'

test('project detail selector owns the canonical URL across refresh and history', async ({
  page,
  runtime,
}) => {
  await page.goto(
    new URL(`/projects/${runtime.seed.defaultProjectId}`, runtime.baseURL).href,
  )
  await expect(
    page.getByRole('heading', { level: 1, name: 'Default Project' }),
  ).toBeVisible()

  const selector = page.getByRole('combobox', { name: '选择项目' })
  await selector.selectOption(runtime.seed.portfolioId)
  await expect(page).toHaveURL(
    new RegExp(`/projects/${runtime.seed.portfolioId}$`),
  )
  await expect(
    page.getByRole('heading', { level: 1, name: 'Lin Portfolio' }),
  ).toBeVisible()

  await page.reload()
  await expect(selector).toHaveValue(runtime.seed.portfolioId)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Lin Portfolio' }),
  ).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL(
    new RegExp(`/projects/${runtime.seed.defaultProjectId}$`),
  )
  await expect(
    page.getByRole('heading', { level: 1, name: 'Default Project' }),
  ).toBeVisible()
})

test('current actor endpoint drives the local actor identity without a client id', async ({
  page,
  request,
  runtime,
}) => {
  const response = await request.get(`${runtime.apiURL}/api/v1/actors/current`)
  expect(response.ok()).toBe(true)
  const envelope = await response.json() as {
    data: { id: string; name: string }
  }
  expect(envelope.data).toMatchObject({
    id: runtime.seed.localActorId,
    name: runtime.seed.localActorName,
  })

  const currentActorRequests: Array<{ method: string; url: string }> = []
  page.on('request', (browserRequest) => {
    if (browserRequest.url().includes('/api/v1/actors/current')) {
      currentActorRequests.push({
        method: browserRequest.method(),
        url: browserRequest.url(),
      })
    }
  })
  await page.goto(new URL('/actors', runtime.baseURL).href)
  await expect(
    page.getByRole('button', {
      name: new RegExp(`${runtime.seed.localActorName}.*当前操作者`),
    }),
  ).toBeVisible()
  expect(currentActorRequests.length).toBeGreaterThanOrEqual(1)
  for (const currentActorRequestRecord of currentActorRequests) {
    const currentActorRequest = new URL(currentActorRequestRecord.url)
    expect(currentActorRequestRecord.method).toBe('GET')
    expect(currentActorRequest.pathname).toBe('/api/v1/actors/current')
    expect(currentActorRequest.search).toBe('')
  }

  await page.getByRole('link', { name: '仪表盘' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: '全局驾驶舱' }),
  ).toBeVisible()
  await expect(page.getByRole('region', { name: '协作者状态' })).toBeVisible()
})

test('shows all projects, filters by owner, and creates a task inside its project', async ({
  page,
  runtime,
}) => {
  await page.goto(new URL('/projects', runtime.baseURL).href)
  await expect(
    page.getByRole('heading', { level: 1, name: '全部项目' }),
  ).toBeVisible()

  const rail = page.locator('.app-rail')
  await expect(rail.getByRole('link', { name: 'Project OS' })).toBeVisible()
  for (const group of ['概览', '交付', '质量', '系统']) {
    await expect(rail.getByRole('group', { name: group })).toBeVisible()
  }
  for (const label of [
    '仪表盘',
    '项目',
    '负责人',
    '项目详情',
    '计划 / 任务',
    '甘特图',
    '需求',
    '缺陷',
    '设置',
  ]) {
    await expect(
      rail.getByRole('link', { name: label, exact: true }),
    ).toBeVisible()
  }
  await expect(rail.getByRole('region', { name: '当前工作区' })).toBeVisible()
  await expect(rail.getByRole('region', { name: '当前负责人' })).toBeVisible()
  await expect(page.getByRole('button', { name: /(?:展开|收起)侧边栏/ }))
    .toHaveCount(0)
  await expect(page.locator('.app-header')).toHaveCount(0)

  await expect(page.getByRole('article', { name: 'Default Project' })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Lin Portfolio' })).toBeVisible()

  await page.getByRole('button', { name: runtime.seed.ownerName, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`owner=${runtime.seed.ownerId}`))
  await expect(page.getByRole('article', { name: 'Lin Portfolio' })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Default Project' })).toHaveCount(0)
  await page.getByRole('button', { name: '全部负责人' }).click()

  await page.getByRole('button', { name: '新建项目' }).click()
  const createProject = page.getByRole('dialog', { name: '新建项目' })
  await createProject.getByLabel('项目名称').fill('Agent Skill 安装体验')
  await createProject
    .getByLabel('主要负责人')
    .selectOption({ label: runtime.seed.ownerName })
  await createProject.getByLabel('项目描述').fill('真实浏览器项目旅程')
  await createProject.getByLabel('开始日期').fill('2026-08-01')
  await createProject.getByLabel('截止日期').fill('2026-08-31')
  await createProject.getByRole('button', { name: '创建项目' }).click()

  const createdProject = page.getByRole('article', {
    name: 'Agent Skill 安装体验',
  })
  await expect(createdProject).toBeVisible()
  await expect(createdProject.getByText(runtime.seed.ownerName, { exact: true }))
    .toBeVisible()
  await createdProject
    .getByRole('link', { name: '进入 Agent Skill 安装体验 详情' })
    .click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Agent Skill 安装体验' }),
  ).toBeVisible()

  await page.getByRole('button', { name: '新建任务' }).click()
  const createTask = page.getByRole('dialog', {
    name: '在 Agent Skill 安装体验 中创建任务',
  })
  await expect(createTask.getByLabel('负责人').locator('option')).toHaveText([
    '请选择',
    runtime.seed.ownerName,
  ])
  await createTask.getByLabel('任务标题').fill('安装 Skill 并验证')
  await createTask.getByLabel('任务描述').fill('仅在当前项目内创建')
  await createTask
    .getByLabel('负责人')
    .selectOption({ label: runtime.seed.ownerName })
  await createTask.getByLabel('开始日期').fill('2026-08-02')
  await createTask.getByLabel('截止日期').fill('2026-08-05')
  await createTask.getByLabel('优先级').selectOption('P0')
  await createTask.getByRole('button', { name: '创建任务' }).click()

  const taskItem = page.getByRole('listitem').filter({
    hasText: '安装 Skill 并验证',
  })
  await expect(taskItem).toContainText(runtime.seed.ownerName)
  await expect(taskItem).toContainText('P0')
})

test('creates, edits, and deactivates a human while exposing the Agent ID', async ({
  context,
  page,
  runtime,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto(new URL('/actors', runtime.baseURL).href)
  await expect(
    page.getByRole('heading', { level: 1, name: '协作者网络' }),
  ).toBeVisible()

  const directory = page.getByRole('group', { name: '协作者管理目录' })
  await directory.locator('summary').click()
  const agentRow = directory.getByRole('row', {
    name: new RegExp(runtime.seed.agentName),
  })
  await expect(agentRow).toContainText('Agent')
  await expect(agentRow).toContainText('codex')
  await expect(agentRow).toContainText(runtime.seed.agentId)
  await agentRow
    .getByRole('button', { name: `复制 ${runtime.seed.agentName} 的 Agent ID` })
    .click()
  await expect(page.getByRole('status')).toContainText('已复制')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(runtime.seed.agentId)

  await page.getByRole('button', { name: '新增负责人' }).click()
  const createHuman = page.getByRole('dialog', { name: '新增负责人' })
  await createHuman.getByLabel('姓名').fill('Journey Owner')
  await createHuman.getByLabel('人类角色').selectOption('owner')
  await createHuman.getByLabel('能力').fill('planning, delivery')
  await createHuman.getByRole('button', { name: '创建负责人' }).click()

  let humanRow = directory.getByRole('row', { name: /Journey Owner/ })
  await expect(humanRow).toContainText('人类')
  await humanRow.getByRole('button', { name: '编辑 Journey Owner' }).click()
  const editHuman = page.getByRole('dialog', { name: '编辑负责人' })
  await editHuman.getByLabel('姓名').fill('Journey Owner Edited')
  await editHuman.getByRole('button', { name: '保存负责人' }).click()

  humanRow = directory.getByRole('row', { name: /Journey Owner Edited/ })
  await humanRow
    .getByRole('button', { name: '停用 Journey Owner Edited' })
    .click()
  const deactivate = page.getByRole('dialog', {
    name: '确认停用 Journey Owner Edited',
  })
  await deactivate.getByRole('button', { name: '确认停用' }).click()
  await expect(humanRow).toHaveAttribute('aria-disabled', 'true')
  await expect(humanRow).toContainText('已停用')
})

test('keeps settings populated and persists saved appearance after reload', async ({
  page,
  runtime,
}) => {
  const initialSettingsResponse = await fetch(
    `${runtime.apiURL}/api/v1/settings`,
  )
  expect(initialSettingsResponse.ok).toBe(true)
  const initialSettings = await initialSettingsResponse.json() as {
    data: { version: number }
  }

  await page.goto(new URL('/settings', runtime.baseURL).href)
  await expect(
    page.getByRole('heading', { level: 1, name: '设置中心' }),
  ).toBeVisible()
  const categories = page.getByRole('tablist', { name: '设置分类' })
  await expect(categories.getByRole('tab')).toHaveCount(4)
  await expect(categories.getByRole('tab', { name: '外观' }))
    .toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: '外观', exact: true }))
    .toBeVisible()

  await page.getByLabel('深色').check()
  await page.getByLabel('渐变').check()
  await page.getByLabel('紫色').check()
  await page.getByLabel('紧凑').check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-background', 'gradient')
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'purple')
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact')
  await page.getByRole('button', { name: '保存外观设置' }).click()
  await expect(page.getByRole('status')).toContainText('外观设置已保存')

  const savedSettingsResponse = await fetch(
    `${runtime.apiURL}/api/v1/settings`,
  )
  expect(savedSettingsResponse.ok).toBe(true)
  const savedSettings = await savedSettingsResponse.json() as {
    data: {
      theme: string
      background: string
      accent: string
      density: string
      version: number
    }
  }
  expect(savedSettings.data).toMatchObject({
    theme: 'dark',
    background: 'gradient',
    accent: 'purple',
    density: 'compact',
  })
  expect(savedSettings.data.version).toBeGreaterThan(
    initialSettings.data.version,
  )

  await page.evaluate(() => {
    localStorage.removeItem('project-os:appearance')
  })
  await page.reload()
  await expect(page.getByLabel('深色')).toBeChecked()
  await expect(page.getByLabel('渐变')).toBeChecked()
  await expect(page.getByLabel('紫色')).toBeChecked()
  await expect(page.getByLabel('紧凑')).toBeChecked()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  await categories.getByRole('tab', { name: '数据' }).click()
  await expect(page.getByRole('heading', { name: '常规', exact: true }))
    .toBeVisible()
  await expect(page.getByRole('heading', { name: '数据', exact: true }))
    .toBeVisible()
  await expect(page.getByRole('button', { name: '创建备份' })).toBeVisible()
  await expect(page.getByRole('button', { name: '导出 JSON' })).toBeVisible()
  await expect(page.getByLabel('选择要导入的 JSON 文件')).toBeAttached()

  await categories.getByRole('tab', { name: 'Skills' }).click()
  await expect(page.getByRole('heading', { name: 'Agent Skills' }))
    .toBeVisible()
  await expect(
    page.getByRole('button', { name: '下载 Project OS Skill' }),
  ).toBeVisible()
  const moreClients = page.getByRole('group', { name: '更多客户端配置' })
  await moreClients.locator('summary').click()
  for (const client of ['Codex', 'Claude Code', 'Kimi Code']) {
    await expect(
      page.getByRole('button', { name: `复制 ${client} 配置` }),
    ).toBeEnabled()
  }
})
