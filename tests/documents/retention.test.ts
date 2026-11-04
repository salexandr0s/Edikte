import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  deleteDocumentFiles,
  selectExpiredDocuments,
  type RetentionCandidate,
} from '../../src/main/documents/retention'

function candidate(
  documentId: number,
  caseClosedAt: string | null,
  extra: Partial<RetentionCandidate> = {},
): RetentionCandidate {
  const edictId = String(documentId).repeat(32)
  return { documentId, localPath: `${edictId}/g.pdf`, caseClosedAt, keep: false, ...extra }
}

describe('selectExpiredDocuments', () => {
  it('selects stored files of cases closed for at least the retention period', () => {
    const candidates = [
      candidate(1, '2026-08-01'),
      candidate(2, '2026-08-06T12:00:00.000Z'),
      candidate(3, '2026-10-01'),
      candidate(4, null),
      candidate(5, '2026-01-01', { keep: true }),
      candidate(6, '2026-01-01', { localPath: null }),
      candidate(7, 'unknown'),
    ]
    const expired = selectExpiredDocuments(candidates, {
      retentionDays: 90,
      now: new Date('2026-11-04T12:00:00.000Z'),
    })
    expect(expired.map((entry) => entry.documentId)).toEqual([1, 2])
  })
})

describe('deleteDocumentFiles', () => {
  let base: string
  let root: string

  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), 'edikte-retention-'))
    root = path.join(base, 'documents')
    await mkdir(root)
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it.skipIf(process.platform === 'win32')(
    'deletes only inside the documents folder and removes emptied folders',
    async () => {
      const [first, second, linked] = ['1'.repeat(32), '2'.repeat(32), '3'.repeat(32)]
      await mkdir(path.join(root, first))
      await mkdir(path.join(root, second))
      await mkdir(path.join(base, 'outside'))
      await writeFile(path.join(root, first, 'one.pdf'), 'x')
      await writeFile(path.join(root, first, 'two.pdf'), 'x')
      await writeFile(path.join(root, second, 'three.pdf'), 'x')
      await writeFile(path.join(base, 'outside', 'secret.pdf'), 'x')
      // An edict folder that is a link to somewhere else.
      await symlink(path.join(base, 'outside'), path.join(root, linked))

      const outcome = await deleteDocumentFiles(root, [
        `${first}/one.pdf`,
        `${second}/three.pdf`,
        `${linked}/secret.pdf`,
        '../outside/secret.pdf',
        `${first}/missing.pdf`,
      ])

      expect(outcome).toEqual({
        deleted: [`${first}/one.pdf`, `${second}/three.pdf`],
        missing: [`${first}/missing.pdf`],
        refused: [`${linked}/secret.pdf`, '../outside/secret.pdf'],
      })
      expect(await readdir(path.join(root, first))).toEqual(['two.pdf'])
      expect(existsSync(path.join(root, second))).toBe(false)
      expect(existsSync(path.join(base, 'outside', 'secret.pdf'))).toBe(true)
    },
  )
})
