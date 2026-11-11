import { Notification } from 'electron'
import type { NotificationSummary } from '@shared/notifications'
import type { DesktopAdapter } from './notification-service'
import {
  notificationIdFromActivationArguments,
  notificationIdFromLaunchInfo,
} from './native-activation'

export interface DesktopMessage {
  title: string
  body: string
}

interface NativeAdapterOptions {
  onOpen: (id: number) => void
  format: (notification: NotificationSummary | null) => DesktopMessage
}

const ID_PREFIX = 'edikte-notification-'
const ACTIVATION_PREFIX = 'edikte-notification:'

function xmlText(text: string): string {
  return text.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&apos;'
    }
  })
}

/** Keeps native transport separate from persistence and Node-only service tests. */
export function createElectronNotificationAdapter(options: NativeAdapterOptions): DesktopAdapter {
  const notifications = new Set<Notification>()
  let disposed = false

  const attach = (notification: Notification, id: number | null): void => {
    notifications.add(notification)
    if (id !== null)
      notification.on('click', () => {
        if (!disposed) options.onOpen(id)
      })
  }

  return {
    isSupported: () => Notification.isSupported(),
    show: (summary, onFailed) => {
      const id = summary?.id ?? null
      const message = options.format(summary)
      const notification = new Notification({
        ...message,
        id: id === null ? `${ID_PREFIX}test` : `${ID_PREFIX}${id}`,
        groupId: 'edikte-listings',
        ...(process.platform === 'win32' && id !== null
          ? {
              toastXml: `<toast launch="${ACTIVATION_PREFIX}${id}"><visual><binding template="ToastGeneric"><text>${xmlText(message.title)}</text><text>${xmlText(message.body)}</text></binding></visual></toast>`,
            }
          : {}),
      })
      attach(notification, id)
      notification.on('failed', (_event, error) => {
        if (!disposed) onFailed(error)
      })
      notification.show()
    },
    restore: async () => {
      if (process.platform === 'win32') {
        Notification.handleActivation((activation) => {
          const id = notificationIdFromActivationArguments(activation.arguments)
          if (id !== null && !disposed) options.onOpen(id)
        })
      }
      if (process.platform === 'darwin' && Notification.isSupported()) {
        for (const notification of await Notification.getHistory()) {
          attach(notification, notificationIdFromLaunchInfo({ identifier: notification.id }))
        }
      }
    },
    dispose: () => {
      disposed = true
      for (const notification of notifications) notification.removeAllListeners()
      notifications.clear()
    },
  }
}
