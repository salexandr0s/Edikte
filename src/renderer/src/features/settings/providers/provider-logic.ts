import {
  PROVIDER_IDS,
  PROVIDER_KINDS,
  type ApiKeyProviderId,
  type CliProviderId,
  type ModelOption,
  type ProviderId,
  type ProviderStatus,
} from '@shared/providers'

// Pure helpers for provider statuses. No DOM access, so the unit tests can
// import them in Node.

/** What a provider channel answers: one provider's status or the whole list. */
export type ProviderUpdate = ProviderStatus | ProviderStatus[]

export function isCliProvider(id: ProviderId): id is CliProviderId {
  return PROVIDER_KINDS[id] === 'cli'
}

export function isApiKeyProvider(id: ProviderId): id is ApiKeyProviderId {
  return PROVIDER_KINDS[id] === 'api_key'
}

/** Statuses in the order of PROVIDER_IDS. */
export function sortProviders(list: readonly ProviderStatus[]): ProviderStatus[] {
  return [...list].sort((a, b) => PROVIDER_IDS.indexOf(a.id) - PROVIDER_IDS.indexOf(b.id))
}

/** Merges a channel answer into the list. Before the first list arrives there is nothing to merge into. */
export function applyProviderUpdate(
  current: ProviderStatus[] | null,
  update: ProviderUpdate,
): ProviderStatus[] | null {
  if (Array.isArray(update)) return sortProviders(update)
  if (current === null) return null
  return sortProviders([...current.filter((status) => status.id !== update.id), update])
}

/** The newest `checkedAt` of all providers. ISO UTC strings sort by time. */
export function lastChecked(list: readonly ProviderStatus[]): string | null {
  let latest: string | null = null
  for (const { checkedAt } of list) {
    if (checkedAt !== null && (latest === null || checkedAt > latest)) latest = checkedAt
  }
  return latest
}

export interface ModelChoice {
  /** The option the select shows as chosen. */
  value: string
  /** A saved model the provider does not list (a typed ID, or a retired model). */
  extra: string | null
}

/** Which option to show for the saved model; null means the provider's default. */
export function modelChoice(options: readonly ModelOption[], saved: string | null): ModelChoice {
  if (saved !== null) {
    return { value: saved, extra: options.some((option) => option.id === saved) ? null : saved }
  }
  const fallback = options.find((option) => option.isDefault) ?? options[0]
  return { value: fallback?.id ?? '', extra: null }
}
