import { useEffect, useEffectEvent } from 'react'
import type { EventPayload } from '@shared/ipc'
import type { EventChannel } from '@shared/ipc-channels'
import { subscribe } from './bridge'

/** Listens to an event from main while the component is mounted. */
export function useBridgeEvent<E extends EventChannel>(
  event: E,
  listener: (payload: EventPayload<E>) => void,
): void {
  const onEvent = useEffectEvent(listener)
  useEffect(() => subscribe(event, (payload) => onEvent(payload)), [event])
}
