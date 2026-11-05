import { lstat, readdir, realpath, rm, rmdir } from 'node:fs/promises'
import path from 'node:path'
import { isInside, splitLocalPath } from './document-protocol'
import { EDICT_ID_PATTERN } from './file-names'

// Downloaded Gutachten name the owners, so files are deleted once a case has
// been closed for longer than the retention setting.

export interface RetentionCandidate {
  documentId: number
  /** documents.localPath; null when nothing is stored. */
  localPath: string | null
  /**
   * When the case closed (sold, distributed, cancelled or removed from the
   * site), as an ISO timestamp or YYYY-MM-DD; null while the case is open.
   */
  caseClosedAt: string | null
  /** True for listings the user keeps, such as starred ones. */
  keep: boolean
}

const DAY_MS = 86_400_000

/** Documents whose case closed at least `retentionDays` ago. */
export function selectExpiredDocuments(
  candidates: readonly RetentionCandidate[],
  options: { retentionDays: number; now: Date },
): RetentionCandidate[] {
  const cutoff = options.now.getTime() - options.retentionDays * DAY_MS
  return candidates.filter((candidate) => {
    if (candidate.localPath === null || candidate.keep || candidate.caseClosedAt === null) {
      return false
    }
    const closedAt = Date.parse(candidate.caseClosedAt)
    return Number.isFinite(closedAt) && closedAt <= cutoff
  })
}

export interface DeleteOutcome {
  deleted: string[]
  missing: string[]
  /** Paths outside the documents folder or of the wrong shape; left untouched. */
  refused: string[]
}

/**
 * Deletes files by documents.localPath, only inside the documents folder
 * (resolved, so a symlinked edict folder cannot point elsewhere), then removes
 * edict folders left empty.
 */
export async function deleteDocumentFiles(
  documentsDir: string,
  localPaths: readonly string[],
): Promise<DeleteOutcome> {
  const outcome: DeleteOutcome = { deleted: [], missing: [], refused: [] }
  let root: string
  try {
    root = await realpath(documentsDir)
  } catch {
    return { ...outcome, missing: [...localPaths] }
  }
  const folders = new Set<string>()
  for (const localPath of localPaths) {
    const segments = splitLocalPath(localPath)
    if (segments === null) {
      outcome.refused.push(localPath)
      continue
    }
    const [edictId, name] = segments
    let folder: string
    try {
      folder = await realpath(path.join(root, edictId))
    } catch {
      outcome.missing.push(localPath)
      continue
    }
    if (folder !== path.join(root, edictId) || !isInside(root, folder)) {
      outcome.refused.push(localPath)
      continue
    }
    const file = path.join(folder, name)
    try {
      const info = await lstat(file)
      if (!info.isFile() && !info.isSymbolicLink()) {
        outcome.refused.push(localPath)
        continue
      }
      // rm on a symlink removes the link, never its target.
      await rm(file)
      outcome.deleted.push(localPath)
      folders.add(folder)
    } catch {
      outcome.missing.push(localPath)
    }
  }
  for (const folder of folders) {
    await rmdir(folder).catch(() => undefined)
  }
  return outcome
}

/** Temporary download files, as download.ts names them. */
const PART_FILE = /^\.[0-9a-f]{16}\.part$/
/** Far longer than a download may run, so an older .part file was left behind. */
export const STALE_PART_AGE_MS = 6 * 60 * 60 * 1000

/**
 * Deletes the temporary files of downloads that a crash or a failed clean-up
 * left in the edict folders, once they are older than any download may run.
 * Returns their paths relative to the documents folder.
 */
export async function deleteStalePartFiles(
  documentsDir: string,
  options: { now: Date; maxAgeMs?: number },
): Promise<string[]> {
  const cutoff = options.now.getTime() - (options.maxAgeMs ?? STALE_PART_AGE_MS)
  let root: string
  try {
    root = await realpath(documentsDir)
  } catch {
    return []
  }
  const deleted: string[] = []
  for (const folder of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    // Symlinked folders are skipped: isDirectory() is false for a link.
    if (!folder.isDirectory() || !EDICT_ID_PATTERN.test(folder.name)) continue
    const dir = path.join(root, folder.name)
    let removed = false
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isFile() || !PART_FILE.test(entry.name)) continue
      const file = path.join(dir, entry.name)
      try {
        if ((await lstat(file)).mtimeMs > cutoff) continue
        await rm(file)
        deleted.push(`${folder.name}/${entry.name}`)
        removed = true
      } catch {
        // Gone already or locked; the next run tries again.
      }
    }
    if (removed) await rmdir(dir).catch(() => undefined)
  }
  return deleted
}
