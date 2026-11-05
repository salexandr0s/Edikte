// @ts-check
/**
 * Reads the machine type from the header of a Windows PE file (.exe, .dll or
 * .node) and fails when it is not the expected architecture. Release CI uses
 * it on the better-sqlite3 binary inside the installed app.
 *
 * Usage: node scripts/check-pe-arch.mjs <file> <x64|arm64|ia32>
 */
import { open } from 'node:fs/promises'

/** IMAGE_FILE_HEADER.Machine values from the PE format specification. */
const MACHINE_TYPES = new Map([
  [0x014c, 'ia32'],
  [0x8664, 'x64'],
  [0xaa64, 'arm64'],
])

const [file, expected] = process.argv.slice(2)
if (file === undefined || expected === undefined) {
  console.error('Usage: node scripts/check-pe-arch.mjs <file> <x64|arm64|ia32>')
  process.exit(2)
}

/**
 * @param {string} filePath
 * @returns {Promise<number>} the Machine field of the COFF file header
 */
async function readMachineType(filePath) {
  const handle = await open(filePath, 'r')
  try {
    const dosHeader = Buffer.alloc(64)
    const dos = await handle.read(dosHeader, 0, dosHeader.length, 0)
    if (dos.bytesRead < dosHeader.length || dosHeader.toString('latin1', 0, 2) !== 'MZ') {
      throw new Error('no MZ header, so this is not a PE file')
    }
    // e_lfanew holds the offset of the "PE\0\0" signature, which the COFF header follows.
    const peOffset = dosHeader.readUInt32LE(0x3c)
    const peHeader = Buffer.alloc(6)
    const pe = await handle.read(peHeader, 0, peHeader.length, peOffset)
    if (pe.bytesRead < peHeader.length || peHeader.toString('latin1', 0, 4) !== 'PE\0\0') {
      throw new Error('no PE signature where the MZ header points')
    }
    return peHeader.readUInt16LE(4)
  } finally {
    await handle.close()
  }
}

try {
  const machine = await readMachineType(file)
  const arch = MACHINE_TYPES.get(machine) ?? `unknown (0x${machine.toString(16)})`
  console.log(`${file}: ${arch}`)
  if (arch !== expected) {
    console.error(`::error::${file} is ${arch}, expected ${expected}`)
    process.exit(1)
  }
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error)
  console.error(`::error::Cannot read the machine type of ${file}: ${reason}`)
  process.exit(1)
}
