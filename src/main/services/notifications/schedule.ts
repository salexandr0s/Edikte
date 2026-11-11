/** Calendar schedules follow Vienna wall time, independently of the host's time zone. */
export interface DigestSchedule {
  cadence: 'after_sync' | 'daily' | 'weekly'
  time: string
  weekday: number
}

interface CalendarTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Vienna',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function calendarTime(at: number): CalendarTime {
  const fields = new Map(formatter.formatToParts(at).map((part) => [part.type, part.value]))
  return {
    year: Number(fields.get('year')),
    month: Number(fields.get('month')),
    day: Number(fields.get('day')),
    hour: Number(fields.get('hour')),
    minute: Number(fields.get('minute')),
  }
}

function nominalUtc(value: CalendarTime): number {
  return Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute)
}

/** Picks the first occurrence of a repeated time and the next valid minute of a gap. */
function wallTimeToUtc(target: CalendarTime): number {
  const nominal = nominalUtc(target)
  const offsets = new Set<number>()
  // Both sides of a seasonal change must contribute an offset.
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = nominal + hours * 60 * MINUTE
    offsets.add(nominalUtc(calendarTime(sample)) - sample)
  }
  for (let forward = 0; forward <= 180; forward += 1) {
    const shifted = nominal + forward * MINUTE
    const matches: number[] = []
    for (const offset of offsets) {
      const candidate = shifted - offset
      if (nominalUtc(calendarTime(candidate)) === shifted) matches.push(candidate)
    }
    if (matches.length > 0) return Math.min(...matches)
  }
  throw new RangeError('Could not resolve the Vienna notification schedule')
}

/** The next occurrence strictly after `after`; after-sync schedules have no timer. */
export function nextAlertDue(schedule: DigestSchedule, after: Date): string | null {
  if (schedule.cadence === 'after_sync') return null
  const local = calendarTime(after.getTime())
  const [hour = 9, minute = 0] = schedule.time.split(':').map(Number)
  const startDay = Date.UTC(local.year, local.month - 1, local.day)
  for (let day = 0; day <= 8; day += 1) {
    const date = new Date(startDay + day * DAY)
    const weekday = date.getUTCDay() || 7
    if (schedule.cadence === 'weekly' && weekday !== schedule.weekday) continue
    const at = wallTimeToUtc({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour,
      minute,
    })
    if (at > after.getTime()) return new Date(at).toISOString()
  }
  throw new RangeError('Could not find the next notification schedule')
}
