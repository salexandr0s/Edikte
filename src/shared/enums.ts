import { z } from 'zod'

// Leaf module: imported by domain.ts and analysis-schema.ts, imports neither.

export const BundeslandSchema = z.enum([
  'wien',
  'noe',
  'bgld',
  'ooe',
  'sbg',
  'stmk',
  'ktn',
  'tirol',
  'vbg',
])
export type Bundesland = z.infer<typeof BundeslandSchema>

/** The section of the Ediktsdatei an edict was published in. */
export const EdictSourceSchema = z.enum(['court_auction', 'insolvency_sale'])
export type EdictSource = z.infer<typeof EdictSourceSchema>

export const PropertyTypeSchema = z.enum([
  'apartment',
  'house',
  'multi_family_house',
  'land',
  'agricultural',
  'commercial',
  'other',
])
export type PropertyType = z.infer<typeof PropertyTypeSchema>

export const NoticeTypeSchema = z.enum([
  'versteigerung',
  'schriftliche_anbote',
  'verschiebung',
  'entfall',
  'zuschlag_ohne_ueberbot',
  'zuschlag_mit_ueberbot',
  'zuschlag_nach_ueberbot',
  'meistbotsverteilung',
  // The two kinds of notice in "Verkäufe und Verpachtungen in Insolvenzverfahren".
  'insolvenzverkauf',
  'insolvenzverpachtung',
  'other',
])
export type NoticeType = z.infer<typeof NoticeTypeSchema>

/** `on_offer` is a sale in insolvency proceedings, which has no auction date. */
export const ListingStatusSchema = z.enum([
  'upcoming',
  'postponed',
  'on_offer',
  'cancelled',
  'sold',
  'closed',
])
export type ListingStatus = z.infer<typeof ListingStatusSchema>

export const AreaKindSchema = z.enum([
  'nutzflaeche',
  'wohnflaeche',
  'grundflaeche',
  'keller',
  'balkon_terrasse',
  'garten',
  'sonstige',
])
export type AreaKind = z.infer<typeof AreaKindSchema>

/** Where an area value came from, in order of precedence. */
export const AreaSourceSchema = z.enum([
  'listing',
  'ai_verified',
  'ai_unverified',
  'local_estimate',
])
export type AreaSource = z.infer<typeof AreaSourceSchema>

export const PriceBasisSchema = z.enum(['schaetzwert', 'geringstes_gebot'])
export type PriceBasis = z.infer<typeof PriceBasisSchema>

export const RiskLevelSchema = z.enum(['low', 'medium', 'high'])
export type RiskLevel = z.infer<typeof RiskLevelSchema>

export const DocumentKindSchema = z.enum([
  'langgutachten',
  'kurzgutachten',
  'plan',
  'photo',
  'other',
])
export type DocumentKind = z.infer<typeof DocumentKindSchema>

export const ApproximateReasonSchema = z.enum([
  'partial_ownership',
  'multiple_units',
  'bundled_parking',
  'area_mismatch',
])
export type ApproximateReason = z.infer<typeof ApproximateReasonSchema>

export const AnalysisStatusSchema = z.enum(['queued', 'running', 'done', 'failed', 'cancelled'])
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>
