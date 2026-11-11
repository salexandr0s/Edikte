import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { BellIcon } from '../../components/ui/icons'
import { useApp } from '../../lib/app-context'
import { invoke } from '../../lib/bridge'
import { useBridgeEvent } from '../../lib/use-bridge-event'

export function NotificationBell() {
  const { t } = useTranslation()
  const { navigate, view } = useApp()
  const [count, setCount] = useState(0)
  const [refresh, setRefresh] = useState(0)
  useBridgeEvent('notifications:changed', () => setRefresh((value) => value + 1))
  useEffect(() => {
    let ignore = false
    invoke('notifications:list', { limit: 1 }).then(
      (page) => {
        if (!ignore) setCount(page.unreadCount)
      },
      () => undefined,
    )
    return () => {
      ignore = true
    }
  }, [refresh])
  return (
    <Button
      variant={view.screen === 'notifications' ? 'secondary' : 'ghost'}
      size="sm"
      aria-label={
        count === 0 ? t('notifications.title') : t('notifications.unreadCount', { count })
      }
      title={t('notifications.title')}
      onClick={() => navigate({ screen: 'notifications' })}
    >
      <BellIcon />
      {count > 0 && (
        <Badge size="sm" variant="primary">
          {count > 99 ? t('notifications.manyUnread') : count}
        </Badge>
      )}
    </Button>
  )
}
