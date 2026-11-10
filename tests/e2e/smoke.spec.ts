import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const projectRoot = path.resolve(import.meta.dirname, '../..')

/** The caller's environment without Electron switches, plus a scratch data folder. */
function launchEnv(userDataDir: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('ELECTRON_')) env[key] = value
  }
  env.EDIKTE_USER_DATA_DIR = userDataDir
  // No sync on launch and no CLI detection: the test must not reach the site or run `claude`.
  env.EDIKTE_OFFLINE = '1'
  return env
}

test('starts the built app, reaches main and switches language', async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'edikte-e2e-'))
  const app = await electron.launch({ args: [projectRoot], env: launchEnv(userDataDir) })
  try {
    const window = await app.firstWindow()
    const consoleErrors: string[] = []
    window.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })

    await expect(window).toHaveTitle('Edikte')
    // Both values come from app:getInfo through the preload bridge.
    const footer = window.getByRole('contentinfo')
    await expect(footer).toContainText(/Version \d+\.\d+\.\d+/)
    await expect(footer).toContainText(userDataDir)

    // A new data folder opens on the first-run screen. Every step moves on with
    // the same button; the last one saves the settings and shows the listings.
    const listingsHeading = window.getByRole('heading', {
      level: 1,
      name: /^(Objekte|Listings)$/,
    })
    const next = window.getByRole('button', { name: /^(Weiter|Continue)$/ })
    await expect(async () => {
      if (await next.isVisible()) await next.click({ timeout: 1_000 })
      await expect(listingsHeading).toBeVisible({ timeout: 1_000 })
    }).toPass({ timeout: 20_000 })

    // The language picker is a custom select: the trigger is a combobox, the
    // menu lists options by their label.
    const language = window.getByRole('combobox', { name: /^(Sprache|Language)$/ })
    const heading = window.getByRole('heading', { level: 1 })
    await language.click()
    await window.getByRole('option', { name: 'Deutsch' }).click()
    await expect(heading).toHaveText('Objekte')
    await expect(window.locator('html')).toHaveAttribute('lang', 'de')
    await language.click()
    await window.getByRole('option', { name: 'English' }).click()
    await expect(heading).toHaveText('Listings')
    await expect(window.locator('html')).toHaveAttribute('lang', 'en')

    expect(consoleErrors).toEqual([])
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})
