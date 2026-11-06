// Captures the README screenshots from the renderer running against the mock
// bridge, so they show made-up sample data. Start `npm run dev:renderer`, then
// run `node scripts/readme-screenshots.mjs [--out docs/screenshots] [--all]`.
// `--all` captures every screen in both colour schemes for a look around.
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { chromium } from '@playwright/test'

const BASE_URL = process.env.EDIKTE_RENDERER_URL ?? 'http://localhost:5173'
const VIEWPORT = { width: 1280, height: 800 }
const LANGUAGES = { de: 'de-AT', en: 'en-GB' }
const FIRST_ROW = 'Eigentumswohnung Top 12'
const SETTLE_MS = 500

/** The screens the README shows. Only the list appears in both colour schemes.
 *  The map is a JPEG: as a PNG it weighs ten times as much as the other screens. */
const README_SHOTS = [
  { screen: 'listings', schemes: ['light', 'dark'], type: 'png' },
  { screen: 'detail', schemes: ['light'], type: 'png' },
  { screen: 'map', schemes: ['light'], type: 'jpeg' },
  { screen: 'filters', schemes: ['light'], type: 'png' },
  { screen: 'settings', schemes: ['light'], type: 'png' },
]
const JPEG_QUALITY = 85

const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
const outDir = path.resolve(outIndex === -1 ? 'docs/screenshots' : args[outIndex + 1])
const shots = args.includes('--all')
  ? README_SHOTS.map((shot) => ({ ...shot, schemes: ['light', 'dark'] }))
  : README_SHOTS

const rendererDir = path.resolve('src/renderer/src')
const strings = Object.fromEntries(
  Object.keys(LANGUAGES).map((lang) => [
    lang,
    Object.assign(
      {},
      ...['i18n', 'features/listings/i18n', 'features/settings/i18n'].map((dir) =>
        JSON.parse(readFileSync(path.join(rendererDir, dir, `${lang}.json`), 'utf8')),
      ),
    ),
  ]),
)

/** The string under a dotted key, in one language. */
function text(lang, key) {
  const value = key.split('.').reduce((node, part) => node?.[part], strings[lang])
  if (typeof value !== 'string') throw new Error(`No string for ${key} in ${lang}`)
  return value
}

/** A name matcher that accepts the string in either language, since the setup
 *  screen switches language while it is open. */
function name(key) {
  const escaped = Object.keys(LANGUAGES).map((lang) =>
    text(lang, key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  )
  return new RegExp(`^(${escaped.join('|')})$`)
}

async function finishSetup(page, lang) {
  await page.goto(BASE_URL)
  await page.getByRole('radio', { name: name(`language.${lang}`) }).click()
  for (let step = 0; step < 3; step += 1) {
    await page.getByRole('button', { name: name('common.continue') }).click()
  }
  await page.getByRole('heading', { name: name('listings.title'), level: 1 }).waitFor()
  await page.getByRole('button', { name: FIRST_ROW, exact: true }).waitFor()
}

const SCREENS = {
  listings: async () => {},
  detail: async (page) => {
    await page.getByRole('button', { name: FIRST_ROW, exact: true }).click()
    await page.getByRole('heading', { name: FIRST_ROW, level: 1 }).waitFor()
  },
  map: async (page) => {
    await page.getByRole('radio', { name: name('map.view.map') }).click()
    await page.locator('.leaflet-tile-loaded').nth(5).waitFor({ timeout: 30_000 })
    await page.waitForTimeout(1500)
  },
  filters: async (page) => {
    await page.getByRole('button', { name: name('filters.title'), exact: true }).click()
    await page.getByRole('dialog').waitFor()
  },
  settings: async (page) => {
    await page.getByRole('button', { name: name('nav.settings') }).click()
    await page.getByRole('heading', { name: name('settings.title'), level: 1 }).waitFor()
  },
}

mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch()
try {
  for (const [lang, locale] of Object.entries(LANGUAGES)) {
    for (const { screen, schemes, type } of shots) {
      for (const colorScheme of schemes) {
        const context = await browser.newContext({
          viewport: VIEWPORT,
          deviceScaleFactor: 2,
          colorScheme,
          locale,
        })
        const page = await context.newPage()
        await finishSetup(page, lang)
        await SCREENS[screen](page)
        await page.waitForTimeout(SETTLE_MS)
        const file = path.join(
          outDir,
          `${screen}-${lang}-${colorScheme}.${type === 'jpeg' ? 'jpg' : 'png'}`,
        )
        await page.screenshot({
          path: file,
          type,
          quality: type === 'jpeg' ? JPEG_QUALITY : undefined,
        })
        console.log(path.relative(process.cwd(), file))
        await context.close()
      }
    }
  }
} finally {
  await browser.close()
}
