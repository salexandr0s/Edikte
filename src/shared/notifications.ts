import { z } from 'zod'
import {
  ListingQuerySchema,
  ListingRowSchema,
  SavedFilterSchema,
  SyncRunSummarySchema,
} from './domain'
import { EdictSourceSchema } from './enums'

export const AlertCadenceSchema = z.enum(['after_sync', 'daily', 'weekly'])
export const AlertConfigSchema = z
  .object({
    filterId: z.number().int().positive(),
    enabled: z.boolean(),
    cadence: AlertCadenceSchema,
    time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    weekday: z.number().int().min(1).max(7),
    desktopEnabled: z.boolean(),
  })
  .strict()
export type AlertConfig = z.infer<typeof AlertConfigSchema>
export const AlertRuleSchema = AlertConfigSchema.extend({
  revision: z.number().int().positive(),
  nextDueAt: z.string().nullable(),
})
export type AlertRule = z.infer<typeof AlertRuleSchema>

export const SourceCoverageSchema = z.object({
  source: EdictSourceSchema,
  lastSuccessAt: z.string().nullable(),
  lastRun: SyncRunSummarySchema.nullable(),
})
export type SourceCoverage = z.infer<typeof SourceCoverageSchema>

export const DesktopAttemptSchema = z.enum([
  'not_requested',
  'pending',
  'attempted',
  'failed',
  'unsupported',
])
export type DesktopAttempt = z.infer<typeof DesktopAttemptSchema>
export const NotificationSummarySchema = z.object({
  id: z.number().int().positive(),
  filterId: z.number().int().positive().nullable(),
  filterName: z.string(),
  presetKey: SavedFilterSchema.shape.presetKey,
  query: ListingQuerySchema,
  createdAt: z.string(),
  periodFrom: z.string(),
  periodTo: z.string(),
  count: z.number().int().positive(),
  readAt: z.string().nullable(),
  coverage: z.array(SourceCoverageSchema),
  desktopStatus: DesktopAttemptSchema,
  desktopError: z.string().nullable(),
})
export type NotificationSummary = z.infer<typeof NotificationSummarySchema>

export const CollectionSectionSchema = z.enum(['all', 'new', 'upcoming', 'starred'])
export type CollectionSection = z.infer<typeof CollectionSectionSchema>
export const ListingCollectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('query'), query: ListingQuerySchema }).strict(),
  z
    .object({
      kind: z.literal('saved_searches'),
      filterId: z.number().int().positive().nullable(),
      section: CollectionSectionSchema,
    })
    .strict(),
  z
    .object({ kind: z.literal('notification'), notificationId: z.number().int().positive() })
    .strict(),
])
export type ListingCollection = z.infer<typeof ListingCollectionSchema>

export const CollectionItemSchema = z.object({
  listing: ListingRowSchema,
  current: ListingRowSchema.nullable(),
  filterIds: z.array(z.number().int().positive()),
  discoveryId: z.number().int().positive().nullable(),
})
export type CollectionItem = z.infer<typeof CollectionItemSchema>
export const CollectionPageSchema = z.object({
  items: z.array(CollectionItemSchema),
  total: z.number().int().nonnegative(),
  filterNames: z.array(z.string()),
})
export type CollectionPage = z.infer<typeof CollectionPageSchema>

export const NotificationDetailSchema = z.object({
  notification: NotificationSummarySchema,
  items: z.array(CollectionItemSchema),
})
export type NotificationDetail = z.infer<typeof NotificationDetailSchema>
export const NotificationListRequestSchema = z
  .object({
    filterId: z.number().int().positive().optional(),
    unreadOnly: z.boolean().default(false),
    beforeId: z.number().int().positive().optional(),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict()
export type NotificationListRequest = z.input<typeof NotificationListRequestSchema>
export const NotificationListPageSchema = z.object({
  items: z.array(NotificationSummarySchema),
  nextCursor: z.number().int().positive().nullable(),
  unreadCount: z.number().int().nonnegative(),
})
export type NotificationListPage = z.infer<typeof NotificationListPageSchema>
export const DeliveryStatusSchema = z.object({
  supported: z.boolean(),
  lastAttemptAt: z.string().nullable(),
  lastStatus: z.enum(['unknown', 'attempted', 'failed', 'unsupported']),
  lastError: z.string().nullable(),
})
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>

export const DashboardSearchSchema = z.object({
  filter: SavedFilterSchema,
  matchCount: z.number().int().nonnegative(),
  newCount: z.number().int().nonnegative(),
  alert: AlertRuleSchema,
  inScope: z.boolean(),
})
export type DashboardSearch = z.infer<typeof DashboardSearchSchema>
export const DashboardDataSchema = z.object({
  generatedAt: z.string(),
  counts: z.object({
    matching: z.number().int().nonnegative(),
    new: z.number().int().nonnegative(),
    upcoming: z.number().int().nonnegative(),
    starred: z.number().int().nonnegative(),
  }),
  newListings: z.array(CollectionItemSchema),
  upcomingListings: z.array(CollectionItemSchema),
  starredListings: z.array(CollectionItemSchema),
  searches: z.array(DashboardSearchSchema),
  notifications: z.array(NotificationSummarySchema),
  coverage: z.array(SourceCoverageSchema),
  trackingStartedAt: z.string().nullable(),
  totalInScope: z.number().int().nonnegative(),
})
export type DashboardData = z.infer<typeof DashboardDataSchema>
