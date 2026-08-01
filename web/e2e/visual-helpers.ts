import { expect, type Page } from '@playwright/test'

export const screenshotOptions = {
  animations: 'disabled',
  caret: 'hide',
  fullPage: true,
  maxDiffPixels: 100,
} as const

export async function freezeVisualTime(page: Page) {
  await page.clock.setFixedTime(new Date(2026, 6, 28, 12, 15))
}

export async function openReadyPage(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0)
}

export async function openReadyDashboard(page: Page) {
  await openReadyPage(page, '/dashboard')
  await expect(
    page.getByRole('heading', { level: 1, name: '全局驾驶舱' }),
  ).toBeVisible()

  const canvases = page.locator('.echart canvas')
  await expect(canvases).toHaveCount(2)
  for (let index = 0; index < 2; index += 1) {
    await expect(canvases.nth(index)).toBeVisible()
  }

  let previousSignatures: string[] | undefined
  await expect
    .poll(async () => {
      const result = await canvases.evaluateAll((elements) =>
        elements.map((element) => {
          if (!(element instanceof HTMLCanvasElement)) {
            return { paintedPixels: 0, signature: 'not-a-canvas' }
          }
          const context = element.getContext('2d')
          if (!context || element.width === 0 || element.height === 0) {
            return { paintedPixels: 0, signature: 'empty-canvas' }
          }

          const pixels = context.getImageData(
            0,
            0,
            element.width,
            element.height,
          ).data
          let checksum = 2_166_136_261
          let paintedPixels = 0
          for (let offset = 0; offset < pixels.length; offset += 64) {
            const alpha = pixels[offset + 3] ?? 0
            if (alpha > 0) paintedPixels += 1
            checksum ^= pixels[offset] ?? 0
            checksum = Math.imul(checksum, 16_777_619)
            checksum ^= pixels[offset + 1] ?? 0
            checksum = Math.imul(checksum, 16_777_619)
            checksum ^= pixels[offset + 2] ?? 0
            checksum = Math.imul(checksum, 16_777_619)
            checksum ^= alpha
            checksum = Math.imul(checksum, 16_777_619)
          }
          return {
            paintedPixels,
            signature: `${element.width}x${element.height}:${checksum >>> 0}`,
          }
        }),
      )
      const signatures = result.map(({ signature }) => signature)
      const isStable =
        previousSignatures !== undefined &&
        signatures.every(
          (signature, index) => signature === previousSignatures?.[index],
        )
      previousSignatures = signatures
      return (
        result.length === 2 &&
        result.every(({ paintedPixels }) => paintedPixels > 50) &&
        isStable
      )
    })
    .toBe(true)
}
