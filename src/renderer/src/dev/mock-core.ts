import type { AnalysisRecord } from '@shared/analysis-schema'
import type {
  AreaEstimate,
  DocumentInfo,
  ListingRow,
  SavedFilter,
  Settings,
  SyncStatus,
  UserState,
} from '@shared/domain'
import type { EventPayload, IpcHandlerRequest, IpcHandlerResponse } from '@shared/ipc'
import type { EventChannel, InvokeChannel } from '@shared/ipc-channels'
import type { ProviderStatus } from '@shared/providers'

// Types and helpers shared by the mock bridge modules.

export type MockHandlers = {
  [C in InvokeChannel]?: (
    request: IpcHandlerRequest<C>,
  ) => IpcHandlerResponse<C> | Promise<IpcHandlerResponse<C>>
}

export type Emit = <E extends EventChannel>(event: E, payload: EventPayload<E>) => void

export interface MockState {
  settings: Settings
  rows: ListingRow[]
  userState: Map<string, UserState>
  filters: SavedFilter[]
  providers: ProviderStatus[]
  sync: SyncStatus
  documents: DocumentInfo[]
  estimates: AreaEstimate[]
  /** Oldest first. */
  analyses: AnalysisRecord[]
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
