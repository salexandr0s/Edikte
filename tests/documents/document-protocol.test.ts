import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  documentUrl,
  localPathFromUrl,
  resolveDocumentFile,
} from '../../src/main/documents/document-protocol'

const ID = 'fedcba9876543210fedcba9876543210'

describe('document URLs', () => {
  it('round-trip a stored path and carry the page', () => {
    const url = documentUrl(`${ID}/12-Gutachten Teil 1.pdf`, 8)
    expect(url).toBe(`edikte-doc://files/${ID}/12-Gutachten%20Teil%201.pdf#page=8`)
    expect(localPathFromUrl(url)).toBe(`${ID}/12-Gutachten Teil 1.pdf`)
    // A reused window adds a query to force a reload; it names the same file.
    expect(localPathFromUrl(url.replace('#', '?v=3#'))).toBe(`${ID}/12-Gutachten Teil 1.pdf`)
  })

  it.each([
    `edikte-doc://files/${ID}/..%2F..%2Fsecret.pdf`,
    `edikte-doc://files/${ID}/..%5Csecret.pdf`,
    `edikte-doc://files/${ID}/sub/file.pdf`,
    `edikte-doc://files/${ID}/notes.txt`,
    'edikte-doc://files/not-an-edict-id/file.pdf',
    'edikte-doc://files/../etc/passwd.pdf',
    `edikte-doc://other/${ID}/file.pdf`,
    `edikte-doc://files:8080/${ID}/file.pdf`,
    `file:///${ID}/file.pdf`,
    'not a url',
  ])('rejects %s', (url) => {
    expect(localPathFromUrl(url)).toBeNull()
  })
})

describe('resolveDocumentFile', () => {
  let base: string
  let root: string
  let outside: string

  beforeEach(async () => {
    base = await realpath(await mkdtemp(path.join(tmpdir(), 'edikte-protocol-')))
    root = path.join(base, 'documents')
    outside = path.join(base, 'outside')
    await mkdir(path.join(root, ID), { recursive: true })
    await mkdir(outside)
    await writeFile(path.join(root, ID, 'a.pdf'), '%PDF-')
    await writeFile(path.join(outside, 'secret.pdf'), '%PDF-')
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('returns files inside the documents folder', async () => {
    expect(await resolveDocumentFile(root, `${ID}/a.pdf`)).toBe(path.join(root, ID, 'a.pdf'))
    // A sale in insolvency proceedings keeps its files in a folder named after its `mv-` ID.
    await mkdir(path.join(root, 'mv-990001'))
    await writeFile(path.join(root, 'mv-990001', 'b.pdf'), '%PDF-')
    expect(await resolveDocumentFile(root, 'mv-990001/b.pdf')).toBe(
      path.join(root, 'mv-990001', 'b.pdf'),
    )
  })

  it('refuses folders, missing files and malformed paths', async () => {
    await mkdir(path.join(root, ID, 'folder.pdf'))
    expect(await resolveDocumentFile(root, `${ID}/folder.pdf`)).toBeNull()
    expect(await resolveDocumentFile(root, `${ID}/missing.pdf`)).toBeNull()
    expect(await resolveDocumentFile(root, `${ID}/../../outside/secret.pdf`)).toBeNull()
  })

  it.skipIf(process.platform === 'win32')(
    'refuses symlinks that lead out of the folder',
    async () => {
      await symlink(path.join(outside, 'secret.pdf'), path.join(root, ID, 'link.pdf'))
      const linkedId = 'a'.repeat(32)
      await symlink(outside, path.join(root, linkedId))
      expect(await resolveDocumentFile(root, `${ID}/link.pdf`)).toBeNull()
      expect(await resolveDocumentFile(root, `${linkedId}/secret.pdf`)).toBeNull()
    },
  )
})
