import { z } from 'zod'

const LaunchInfoSchema = z.object({ identifier: z.string().regex(/^edikte-notification-\d+$/) })
const ActivationArgumentsSchema = z.string().regex(/^edikte-notification:\d+$/)

function positiveId(value: string, prefix: string): number | null {
  const id = Number(value.slice(prefix.length))
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** The macOS ready event may carry a click before any window or service exists. */
export function notificationIdFromLaunchInfo(value: unknown): number | null {
  const parsed = LaunchInfoSchema.safeParse(value)
  return parsed.success ? positiveId(parsed.data.identifier, 'edikte-notification-') : null
}

/** Windows activation arguments can also arrive after the originating object is gone. */
export function notificationIdFromActivationArguments(value: unknown): number | null {
  const parsed = ActivationArgumentsSchema.safeParse(value)
  return parsed.success ? positiveId(parsed.data, 'edikte-notification:') : null
}
