/**
 * The AI provider service: detection, sign-ins, API keys, selection, models
 * and CLI paths for the five routes, behind the providers:* IPC channels.
 */
export {
  createProviderService,
  type ActiveProvider,
  type ProviderService,
  type ProviderServiceDeps,
} from './provider-service'
export type { ProviderContext, ProviderSet } from './default-providers'
export { registerProviderHandlers } from './handlers'
