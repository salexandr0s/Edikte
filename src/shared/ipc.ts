import { z } from 'zod'
import { AnalysisRecordSchema } from './analysis-schema'
import {
  AnalysisEstimateSchema,
  AnalysisProgressSchema,
  AppInfoSchema,
  DocumentInfoSchema,
  DocumentProgressSchema,
  FillPlanSchema,
  GeocodeProgressSchema,
  ListingDetailSchema,
  ListingPageSchema,
  ListingQuerySchema,
  SavedFilterSchema,
  SettingsPatchSchema,
  SettingsSchema,
  SyncStatusSchema,
  UserStateSchema,
} from './domain'
import type { AppErrorShape } from './errors'
import type { EventChannel, InvokeChannel } from './ipc-channels'
import {
  ApiKeyProviderIdSchema,
  CliProviderIdSchema,
  ModelOptionSchema,
  ProviderIdSchema,
  ProviderStatusSchema,
} from './providers'

/**
 * The IPC contract. Main validates every request and response against these
 * schemas (src/main/ipc/handle.ts); unknown keys in responses are stripped,
 * so a handler cannot leak extra fields such as tokens to the renderer.
 */

const none = z.void()

/** Edict IDs are the site's 32-hex Domino document IDs, stored lowercase. */
export const EdictIdSchema = z.string().regex(/^[0-9a-f]{32}$/)

const EdictIdsSchema = z.object({ edictIds: z.array(EdictIdSchema).min(1).max(2000) }).strict()
const ProviderRequestSchema = z.object({ provider: ProviderIdSchema }).strict()
const CliProviderRequestSchema = z.object({ provider: CliProviderIdSchema }).strict()
const ProviderListSchema = z.array(ProviderStatusSchema)

interface ChannelSchemas {
  request: z.ZodType
  response: z.ZodType
}

export const ipcContract = {
  'app:getInfo': { request: none, response: AppInfoSchema },

  'settings:get': { request: none, response: SettingsSchema },
  'settings:update': { request: SettingsPatchSchema, response: SettingsSchema },

  'sync:start': {
    request: z.object({ full: z.boolean().default(false) }).strict(),
    response: SyncStatusSchema,
  },
  'sync:cancel': { request: none, response: SyncStatusSchema },
  'sync:status': { request: none, response: SyncStatusSchema },

  'listings:query': { request: ListingQuerySchema, response: ListingPageSchema },
  'listings:get': {
    request: z.object({ id: EdictIdSchema }).strict(),
    response: ListingDetailSchema,
  },
  /** Looks up map positions for addresses that have none yet; returns at once. */
  'geocode:run': { request: none, response: GeocodeProgressSchema },

  'userState:update': {
    request: z
      .object({
        caseKey: z.string().min(1).max(500),
        starred: z.boolean().optional(),
        hidden: z.boolean().optional(),
        notes: z.string().max(10_000).optional(),
      })
      .strict(),
    response: UserStateSchema,
  },

  'filters:list': { request: none, response: z.array(SavedFilterSchema) },
  'filters:save': {
    request: z
      .object({
        id: z.number().int().optional(),
        name: z.string().trim().min(1).max(80),
        query: ListingQuerySchema,
      })
      .strict(),
    response: SavedFilterSchema,
  },
  'filters:delete': { request: z.object({ id: z.number().int() }).strict(), response: none },

  'documents:download': {
    request: z.object({ documentId: z.number().int() }).strict(),
    response: DocumentInfoSchema,
  },
  'documents:open': {
    request: z
      .object({ documentId: z.number().int(), page: z.number().int().min(1).optional() })
      .strict(),
    response: none,
  },
  /** Counts what "Fill missing areas" would download, for the confirmation dialog. */
  'documents:planFill': { request: ListingQuerySchema, response: FillPlanSchema },
  'documents:fill': { request: ListingQuerySchema, response: FillPlanSchema },
  'documents:cancelFill': { request: none, response: none },

  'analysis:estimate': { request: EdictIdsSchema, response: AnalysisEstimateSchema },
  'analysis:start': {
    request: EdictIdsSchema,
    response: z.object({ queued: z.number().int().nonnegative() }),
  },
  'analysis:cancel': {
    request: z.union([
      z.object({ analysisId: z.number().int() }).strict(),
      z.object({ all: z.literal(true) }).strict(),
    ]),
    response: none,
  },
  'analysis:list': {
    request: z.object({ edictId: EdictIdSchema }).strict(),
    response: z.array(AnalysisRecordSchema),
  },

  /** Last known status of every provider, without running detection. */
  'providers:list': { request: none, response: ProviderListSchema },
  'providers:detect': { request: none, response: ProviderListSchema },
  /** Starts the provider's own sign-in flow (OAuth in the browser or the CLI's login). */
  'providers:connect': { request: ProviderRequestSchema, response: ProviderStatusSchema },
  'providers:cancelConnect': { request: ProviderRequestSchema, response: ProviderStatusSchema },
  /** Revokes and deletes the app's own credentials. For CLIs it only stops using them. */
  'providers:disconnect': { request: ProviderRequestSchema, response: ProviderStatusSchema },
  /** Write-only: the key is checked by listing models, stored encrypted, never returned. */
  'providers:setApiKey': {
    request: z
      .object({ provider: ApiKeyProviderIdSchema, key: z.string().trim().min(20).max(500) })
      .strict(),
    response: ProviderStatusSchema,
  },
  'providers:models': { request: ProviderRequestSchema, response: z.array(ModelOptionSchema) },
  'providers:select': {
    request: z.object({ provider: ProviderIdSchema.nullable() }).strict(),
    response: ProviderListSchema,
  },
  /** `model: null` goes back to the provider's default model. */
  'providers:setModel': {
    request: z
      .object({
        provider: ProviderIdSchema,
        model: z.string().trim().min(1).max(200).nullable(),
      })
      .strict(),
    response: ProviderStatusSchema,
  },
  /** Opens a file dialog in main; the renderer never supplies a path itself. */
  'providers:chooseCliPath': { request: CliProviderRequestSchema, response: ProviderStatusSchema },
  'providers:resetCliPath': { request: CliProviderRequestSchema, response: ProviderStatusSchema },

  /** Opens an allowlisted https URL in the system browser. */
  'shell:openExternal': { request: z.object({ url: z.url() }).strict(), response: none },
} as const satisfies { [C in InvokeChannel]: ChannelSchemas }

export const eventContract = {
  'sync:progress': SyncStatusSchema,
  /** Listings changed in the database; null means "refetch everything". */
  'listings:changed': z.object({ edictIds: z.array(z.string()).nullable() }),
  'geocode:progress': GeocodeProgressSchema,
  'documents:progress': DocumentProgressSchema,
  'analysis:progress': AnalysisProgressSchema,
  'providers:changed': ProviderListSchema,
} as const satisfies { [E in EventChannel]: z.ZodType }

type Contract = typeof ipcContract

/** What the renderer passes. */
export type IpcRequest<C extends InvokeChannel> = z.input<Contract[C]['request']>
/** What the renderer receives. */
export type IpcResponse<C extends InvokeChannel> = z.output<Contract[C]['response']>
/** What a main-process handler receives after validation. */
export type IpcHandlerRequest<C extends InvokeChannel> = z.output<Contract[C]['request']>
/** What a main-process handler returns before validation. */
export type IpcHandlerResponse<C extends InvokeChannel> = z.input<Contract[C]['response']>

export type EventPayload<E extends EventChannel> = z.output<(typeof eventContract)[E]>

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: AppErrorShape }

/** Arguments after the channel name: none for channels without a request. */
export type IpcRequestArgs<C extends InvokeChannel> = Contract[C]['request'] extends z.ZodVoid
  ? []
  : [request: IpcRequest<C>]

/** The API the preload script exposes as `window.edikte`. */
export interface EdikteBridge {
  invoke<C extends InvokeChannel>(
    channel: C,
    ...request: IpcRequestArgs<C>
  ): Promise<IpcResult<IpcResponse<C>>>
  on<E extends EventChannel>(event: E, listener: (payload: EventPayload<E>) => void): () => void
}
