import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSecretStore, nodeSecretFiles } from '../../../src/main/secure/secret-store'
import { fakeEncryption } from './helpers'

const KEY = 'sk-test-0123456789abcdef'

describe('secret store', () => {
  let dir: string
  let file: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'edikte-secrets-'))
    file = path.join(dir, 'secrets.json')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('round-trips encrypted secrets through an owner-only file', async () => {
    const encryption = fakeEncryption()
    const store = createSecretStore({ file, encryption })
    // Concurrent updates run one after another, so neither is lost.
    await Promise.all([
      store.update((s) => ({ ...s, apiKeys: { ...s.apiKeys, openai: KEY } })),
      store.update((s) => ({ ...s, chatgpt: { ...s.chatgpt, hostId: 'urn:uuid:1' } })),
    ])

    const reread = await createSecretStore({ file, encryption }).read()
    expect(reread.apiKeys.openai).toBe(KEY)
    expect(reread.chatgpt.hostId).toBe('urn:uuid:1')
    expect(await readFile(file, 'utf8')).not.toContain(KEY)
    expect(await readdir(dir)).toEqual(['secrets.json'])
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600)
  })

  it('refuses to save without encryption and leaves no file', async () => {
    const encryption = fakeEncryption()
    encryption.available = false
    const store = createSecretStore({ file, encryption })

    expect((await store.read()).apiKeys.openai).toBeNull()
    await expect(
      store.update((s) => ({ ...s, apiKeys: { ...s.apiKeys, openai: KEY } })),
    ).rejects.toMatchObject({ code: 'storage_unavailable' })
    expect(await readdir(dir)).toEqual([])
  })

  it('keeps the previous file when the replace step fails', async () => {
    const encryption = fakeEncryption()
    await createSecretStore({ file, encryption }).update((s) => ({
      ...s,
      apiKeys: { ...s.apiKeys, openai: KEY },
    }))
    const failing = createSecretStore({
      file,
      encryption,
      files: { ...nodeSecretFiles, rename: () => Promise.reject(new Error('disk full')) },
    })

    await expect(
      failing.update((s) => ({ ...s, apiKeys: { ...s.apiKeys, openai: 'sk-other-key-000000' } })),
    ).rejects.toMatchObject({ code: 'storage_unavailable' })
    expect((await createSecretStore({ file, encryption }).read()).apiKeys.openai).toBe(KEY)
    expect(await readdir(dir)).toEqual(['secrets.json'])
  })

  it('keeps the file and caches nothing while decryption fails', async () => {
    const encryption = fakeEncryption()
    await createSecretStore({ file, encryption }).update((s) => ({
      ...s,
      apiKeys: { ...s.apiKeys, openai: KEY },
    }))
    const before = await readFile(file)
    let locked = true
    const store = createSecretStore({
      file,
      encryption: {
        ...encryption,
        decrypt: (cipherText) => {
          if (locked) throw new Error('keychain locked')
          return encryption.decrypt(cipherText)
        },
      },
    })

    await expect(store.read()).rejects.toMatchObject({ code: 'storage_unavailable' })
    await expect(
      store.update((s) => ({ ...s, apiKeys: { ...s.apiKeys, anthropic: KEY } })),
    ).rejects.toMatchObject({ code: 'storage_unavailable' })
    expect(await readFile(file)).toEqual(before)
    locked = false
    expect((await store.read()).apiKeys.openai).toBe(KEY)
  })

  it('moves a damaged file aside before starting empty', async () => {
    const encryption = fakeEncryption()
    const damaged = JSON.stringify({
      version: 1,
      data: encryption.encrypt('{"apiKeys":{}}').toString('base64'),
    })
    await writeFile(file, damaged)
    const store = createSecretStore({ file, encryption, now: () => 1234 })

    expect((await store.read()).apiKeys.openai).toBeNull()
    await store.update((s) => ({ ...s, apiKeys: { ...s.apiKeys, anthropic: KEY } }))
    expect((await readdir(dir)).sort()).toEqual(['secrets.json', 'secrets.json.bad-1234'])
    expect(await readFile(`${file}.bad-1234`, 'utf8')).toBe(damaged)
    expect((await createSecretStore({ file, encryption }).read()).apiKeys.anthropic).toBe(KEY)
  })
})
