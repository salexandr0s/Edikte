import { safeStorage } from 'electron'
import type { SecretEncryption } from './secret-store'

/**
 * Electron safeStorage (Keychain on macOS, DPAPI on Windows). Linux's
 * `basic_text` backend stores a hard-coded key, so it counts as unavailable.
 */
export function createSafeStorageEncryption(): SecretEncryption {
  return {
    isAvailable: () =>
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    encrypt: (plainText) => safeStorage.encryptString(plainText),
    decrypt: (cipherText) => safeStorage.decryptString(cipherText),
  }
}
