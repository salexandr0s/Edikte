// @ts-check
/**
 * Renders build/icon.svg into the icon files electron-builder packages:
 * build/icon.icns for macOS, build/icon.ico for Windows and build/icon.png,
 * which the Dock and the window show in development. Electron itself does the
 * rasterising, so the script needs no other tool. Only the icns step is
 * limited to macOS, because iconutil writes it; elsewhere the committed icns
 * stays as it is.
 *
 * Usage: npm run icons
 */
import { app, BrowserWindow } from 'electron'
import { execFile } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const buildDir = path.join(import.meta.dirname, '../build')
const CANVAS = 1024
// A render that never paints would otherwise leave the script running.
const TIMEOUT_MS = 60_000

/** The entries of the icns, named as iconutil expects them, with their size in pixels. */
const ICONSET = [
  ['icon_16x16', 16],
  ['icon_16x16@2x', 32],
  ['icon_32x32', 32],
  ['icon_32x32@2x', 64],
  ['icon_128x128', 128],
  ['icon_128x128@2x', 256],
  ['icon_256x256', 256],
  ['icon_256x256@2x', 512],
  ['icon_512x512', 512],
  ['icon_512x512@2x', 1024],
]
/** The entries of the ico. Windows wants the 256 pixel entry as PNG and the smaller ones as bitmaps. */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

/**
 * The SVG carries three versions of the art, chosen by its data-variant
 * attribute: 16 pixels show the § alone, 32 pixels the eagle with the §, and
 * every larger size the whole logo.
 * @param {number} size
 */
function variantFor(size) {
  if (size <= 16) return 'tiny'
  if (size <= 32) return 'small'
  return 'full'
}

/**
 * Renders every size in one offscreen window, drawing the SVG at that size in
 * the top left corner and cropping the frame. One window, because a second
 * renderer process does not start on macOS 26 once the first one is gone, and
 * the frame comes from the paint event, because capturePage() has nothing to
 * copy without a GPU.
 * @param {string} svg
 * @param {number[]} sizes
 * @returns {Promise<Map<number, import('electron').NativeImage>>}
 */
async function rasterise(svg, sizes) {
  const html =
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'html,body{margin:0;background:transparent;overflow:hidden}svg{display:block}' +
    `</style></head><body>${svg}</body></html>`
  const window = new BrowserWindow({
    width: CANVAS,
    height: CANVAS,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true, sandbox: true },
  })
  const images = new Map()
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    for (const size of sizes) {
      // Resolves once the renderer has produced a frame with the new size and variant.
      await window.webContents.executeJavaScript(
        `(() => {
          const svg = document.querySelector('svg')
          svg.setAttribute('data-variant', ${JSON.stringify(variantFor(size))})
          svg.style.width = svg.style.height = '${size}px'
          return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        })()`,
      )
      /** @type {import('electron').NativeImage} */
      const frame = await new Promise((resolve) => {
        window.webContents.once('paint', (_event, _dirty, image) => resolve(image))
        window.webContents.invalidate()
      })
      const { width, height } = frame.getSize()
      if (width !== CANVAS || height !== CANVAS) {
        throw new Error(`The frame is ${width}x${height} instead of ${CANVAS}x${CANVAS}`)
      }
      images.set(size, frame.crop({ x: 0, y: 0, width: size, height: size }))
    }
  } finally {
    window.destroy()
  }
  return images
}

/**
 * A 32-bit bitmap entry for the ico: BITMAPINFOHEADER, BGRA rows from the
 * bottom up with straight alpha, then the 1-bit mask the format still asks for.
 * @param {import('electron').NativeImage} image
 * @param {number} size
 */
function bitmapEntry(image, size) {
  // Electron hands out premultiplied BGRA.
  const premultiplied = image.toBitmap()
  if (premultiplied.length !== size * size * 4) {
    throw new Error(`The ${size} pixel bitmap has ${premultiplied.length} bytes`)
  }
  const rowBytes = size * 4
  const maskRowBytes = Math.ceil(size / 32) * 4
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8)
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(rowBytes * size + maskRowBytes * size, 20)
  const pixels = Buffer.alloc(rowBytes * size)
  const mask = Buffer.alloc(maskRowBytes * size)
  for (let y = 0; y < size; y++) {
    const sourceRow = (size - 1 - y) * rowBytes
    const targetRow = y * rowBytes
    for (let x = 0; x < size; x++) {
      const s = sourceRow + x * 4
      const t = targetRow + x * 4
      const alpha = premultiplied[s + 3]
      for (let channel = 0; channel < 3; channel++) {
        pixels[t + channel] =
          alpha === 0 ? 0 : Math.min(255, Math.round((premultiplied[s + channel] * 255) / alpha))
      }
      pixels[t + 3] = alpha
      if (alpha === 0) mask[y * maskRowBytes + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
  return Buffer.concat([header, pixels, mask])
}

/** @param {{ size: number, data: Buffer }[]} entries */
function icoFile(entries) {
  const directory = Buffer.alloc(6)
  directory.writeUInt16LE(1, 2)
  directory.writeUInt16LE(entries.length, 4)
  let offset = 6 + 16 * entries.length
  const table = []
  for (const { size, data } of entries) {
    const entry = Buffer.alloc(16)
    // The size fields hold one byte each, so 256 is written as 0.
    entry[0] = size % 256
    entry[1] = size % 256
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += data.length
    table.push(entry)
  }
  return Buffer.concat([directory, ...table, ...entries.map((entry) => entry.data)])
}

async function main() {
  const svg = await readFile(path.join(buildDir, 'icon.svg'), 'utf8')
  const sizes = [...new Set([...ICONSET.map(([, size]) => size), ...ICO_SIZES])]
  const images = await rasterise(svg, sizes)
  /** @param {number} size */
  const image = (size) => {
    const found = images.get(size)
    if (found === undefined) throw new Error(`No render for ${size} pixels`)
    return found
  }

  await writeFile(path.join(buildDir, 'icon.png'), image(CANVAS).toPNG())
  console.log('wrote build/icon.png')

  const ico = icoFile(
    ICO_SIZES.map((size) => ({
      size,
      data: size === 256 ? image(size).toPNG() : bitmapEntry(image(size), size),
    })),
  )
  await writeFile(path.join(buildDir, 'icon.ico'), ico)
  console.log('wrote build/icon.ico')

  if (process.platform !== 'darwin') {
    console.log('skipped build/icon.icns: iconutil exists only on macOS')
    return
  }
  const iconset = await mkdtemp(path.join(tmpdir(), 'edikte-icon-'))
  const iconsetDir = path.join(iconset, 'icon.iconset')
  try {
    await mkdir(iconsetDir)
    for (const [name, size] of ICONSET) {
      await writeFile(path.join(iconsetDir, `${name}.png`), image(size).toPNG())
    }
    await promisify(execFile)('iconutil', [
      '-c',
      'icns',
      iconsetDir,
      '-o',
      path.join(buildDir, 'icon.icns'),
    ])
    console.log('wrote build/icon.icns')
  } finally {
    await rm(iconset, { recursive: true, force: true })
  }
}

async function run() {
  // The script has no window to show, so it stays out of the Dock.
  app.dock?.hide()
  let exitCode = 0
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    exitCode = 1
  } finally {
    await rm(app.getPath('userData'), { recursive: true, force: true })
  }
  app.exit(exitCode)
}

// Without a listener Electron quits once the render window is gone, before
// the files are written.
app.on('window-all-closed', () => {})
// One device pixel per CSS pixel, whatever the display.
app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.disableHardwareAcceleration()
// Electron would otherwise keep a profile for this script under the app name.
app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'edikte-icon-profile-')))
setTimeout(() => {
  console.error(`No result after ${TIMEOUT_MS / 1000} seconds`)
  app.exit(1)
}, TIMEOUT_MS)
// Electron emits ready only once this module has finished evaluating, so a
// top-level await of whenReady() would wait forever.
app
  .whenReady()
  .then(run)
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    app.exit(1)
  })
