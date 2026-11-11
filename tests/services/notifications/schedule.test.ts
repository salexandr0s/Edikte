import { describe, expect, it } from 'vitest'
import { nextAlertDue } from '../../../src/main/services/notifications/schedule'

describe('Vienna digest schedules', () => {
  it('uses Vienna time and advances weekly schedules after their occurrence', () => {
    const weekly = { cadence: 'weekly' as const, time: '09:00', weekday: 1 }
    expect(nextAlertDue(weekly, new Date('2026-11-08T12:00:00.000Z'))).toBe(
      '2026-11-09T08:00:00.000Z',
    )
    expect(nextAlertDue(weekly, new Date('2026-11-09T08:00:00.000Z'))).toBe(
      '2026-11-16T08:00:00.000Z',
    )
    expect(
      nextAlertDue({ ...weekly, cadence: 'after_sync' }, new Date('2026-11-08T12:00:00Z')),
    ).toBeNull()
  })

  it('moves a spring gap to the next valid minute', () => {
    expect(
      nextAlertDue(
        { cadence: 'daily', time: '02:30', weekday: 1 },
        new Date('2027-03-27T12:00:00.000Z'),
      ),
    ).toBe('2027-03-28T01:00:00.000Z')
  })

  it('uses the first repeated autumn occurrence and never schedules its second occurrence', () => {
    const daily = { cadence: 'daily' as const, time: '02:30', weekday: 1 }
    expect(nextAlertDue(daily, new Date('2026-10-24T12:00:00.000Z'))).toBe(
      '2026-10-25T00:30:00.000Z',
    )
    expect(nextAlertDue(daily, new Date('2026-10-25T00:30:00.000Z'))).toBe(
      '2026-10-26T01:30:00.000Z',
    )
  })
})
