import path from 'node:path'

export interface AppPaths {
  userData: string
  database: string
  /** Downloaded Gutachten and other files, one folder per edict. */
  documents: string
  /** safeStorage-encrypted file with ChatGPT tokens and API keys. */
  secrets: string
  logs: string
}

export function resolveAppPaths(userData: string): AppPaths {
  return {
    userData,
    database: path.join(userData, 'edikte.sqlite'),
    documents: path.join(userData, 'documents'),
    secrets: path.join(userData, 'secrets.json'),
    logs: path.join(userData, 'logs'),
  }
}
