import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { EdikteBridge } from '../../src/shared/ipc'

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
  env.EDIKTE_DISABLE_DESKTOP_NOTIFICATIONS = '1'
  return env
}

test('opens the dashboard, saves an alert and navigates between result screens', async () => {
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
    // the same button; the last one saves the settings and opens the dashboard.
    const dashboardHeading = window.getByRole('heading', {
      level: 1,
      name: /^(Übersicht|Dashboard)$/,
    })
    const next = window.getByRole('button', { name: /^(Weiter|Continue)$/ })
    await expect(async () => {
      if (await next.isVisible()) await next.click({ timeout: 1_000 })
      await expect(dashboardHeading).toBeVisible({ timeout: 1_000 })
    }).toPass({ timeout: 20_000 })

    // The language picker is a custom select: the trigger is a combobox, the
    // menu lists options by their label.
    const language = window.getByRole('combobox', { name: /^(Sprache|Language)$/ })
    const heading = window.getByRole('heading', { level: 1 })
    await language.click()
    await window.getByRole('option', { name: 'Deutsch' }).click()
    await expect(heading.filter({ visible: true })).toHaveText('Übersicht')
    await expect(window.locator('html')).toHaveAttribute('lang', 'de')
    await language.click()
    await window.getByRole('option', { name: 'English' }).click()
    await expect(heading.filter({ visible: true })).toHaveText('Dashboard')
    await expect(window.locator('html')).toHaveAttribute('lang', 'en')

    await window.getByRole('button', { name: 'Set up alert', exact: true }).click()
    const alert = window.getByRole('dialog', { name: 'Set up alert' })
    const enabled = alert.getByRole('switch', { name: 'Notify me about new listings', exact: true })
    await expect(enabled).toHaveAttribute('aria-checked', 'false')
    await enabled.click()
    await alert.getByLabel('Delivery time', { exact: true }).fill('10:15')
    await alert.getByRole('combobox', { name: 'Day of the week', exact: true }).click()
    await window.getByRole('option', { name: 'Thursday', exact: true }).click()
    await alert.getByRole('switch', { name: 'Show desktop notifications', exact: true }).click()
    await alert.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(alert).not.toBeVisible()

    const rule = await window.evaluate(async () => {
      const bridge = (globalThis as unknown as { edikte: EdikteBridge }).edikte
      const filters = await bridge.invoke('filters:list')
      if (!filters.ok || filters.data[0] === undefined) throw new Error('Missing saved search')
      return bridge.invoke('alerts:get', { filterId: filters.data[0].id })
    })
    expect(rule).toMatchObject({
      ok: true,
      data: {
        enabled: true,
        cadence: 'weekly',
        time: '10:15',
        weekday: 4,
        desktopEnabled: false,
      },
    })

    await window.getByRole('button', { name: 'Notifications', exact: true }).click()
    await expect(window.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible()
    await expect(window.getByText('No notifications yet', { exact: true })).toBeVisible()
    await expect(
      window.getByRole('button', { name: 'Send test notification', exact: true }),
    ).toBeDisabled()
    await expect(
      window.getByText('Desktop notifications are unavailable on this system.', { exact: true }),
    ).toBeVisible()
    await window.getByRole('button', { name: 'Dashboard', exact: true }).click()
    await expect(dashboardHeading).toBeVisible()

    await window.getByRole('button', { name: /Matching properties/ }).click()
    await expect(
      window.getByRole('heading', { level: 1, name: 'Matching properties' }),
    ).toBeVisible()
    await window.getByRole('button', { name: 'Back to Dashboard', exact: true }).click()
    await expect(dashboardHeading).toBeVisible()

    await window.getByRole('button', { name: 'Listings', exact: true }).click()
    await expect(window.getByRole('heading', { level: 1, name: 'Listings' })).toBeVisible()
    await window.getByRole('button', { name: 'Dashboard', exact: true }).click()
    await expect(dashboardHeading).toBeVisible()

    expect(consoleErrors).toEqual([])
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})
