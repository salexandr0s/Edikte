// Channel names only, without schemas, so the preload bundle stays free of Zod.
// src/shared/ipc.ts maps every name to its schemas and fails to compile if one is missing.

export const INVOKE_CHANNELS = [
  'app:getInfo',
  'settings:get',
  'settings:update',
  'sync:start',
  'sync:cancel',
  'sync:status',
  'listings:query',
  'listings:queryCollection',
  'dashboard:get',
  'alerts:get',
  'alerts:update',
  'notifications:list',
  'notifications:get',
  'notifications:markRead',
  'notifications:markAllRead',
  'notifications:deliveryStatus',
  'notifications:testDesktop',
  'notifications:pendingOpen',
  'notifications:ackOpen',
  'listings:get',
  'geocode:run',
  'userState:update',
  'filters:list',
  'filters:save',
  'filters:delete',
  'documents:download',
  'documents:open',
  'documents:planFill',
  'documents:fill',
  'documents:cancelFill',
  'analysis:estimate',
  'analysis:start',
  'analysis:cancel',
  'analysis:list',
  'providers:list',
  'providers:detect',
  'providers:connect',
  'providers:cancelConnect',
  'providers:disconnect',
  'providers:setApiKey',
  'providers:models',
  'providers:select',
  'providers:setModel',
  'providers:chooseCliPath',
  'providers:resetCliPath',
  'shell:openExternal',
] as const

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number]

/** Main → renderer notifications. */
export const EVENT_CHANNELS = [
  'sync:progress',
  'listings:changed',
  'geocode:progress',
  'documents:progress',
  'analysis:progress',
  'providers:changed',
  'filters:changed',
  'alerts:changed',
  'notifications:changed',
  'notifications:open',
] as const

export type EventChannel = (typeof EVENT_CHANNELS)[number]
