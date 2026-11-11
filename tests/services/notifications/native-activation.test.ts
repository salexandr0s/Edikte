import { describe, expect, it } from 'vitest'
import {
  notificationIdFromActivationArguments,
  notificationIdFromLaunchInfo,
} from '../../../src/main/services/notifications/native-activation'

describe('native notification activation identity', () => {
  it('recovers a persisted macOS digest identity before renderer startup', () => {
    expect(notificationIdFromLaunchInfo({ identifier: 'edikte-notification-42' })).toBe(42)
    for (const value of [
      null,
      {},
      { identifier: 42 },
      { identifier: 'edikte-notification-test' },
      { identifier: 'edikte-notification-0' },
      { identifier: 'edikte-notification--1' },
      { identifier: 'edikte-notification-9007199254740992' },
      { identifier: 'edikte-notification-42-extra' },
    ]) {
      expect(notificationIdFromLaunchInfo(value)).toBeNull()
    }
  })

  it('accepts only the app-owned Windows activation argument format', () => {
    expect(notificationIdFromActivationArguments('edikte-notification:42')).toBe(42)
    for (const value of [
      null,
      42,
      'edikte-notification-42',
      'edikte-notification:0',
      'edikte-notification:42?other=1',
      'edikte-notification:9007199254740992',
    ]) {
      expect(notificationIdFromActivationArguments(value)).toBeNull()
    }
  })
})
