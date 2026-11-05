import type { IpcRouter } from '../../ipc/handle'
import type { ProviderService } from './provider-service'

/** Answers every providers:* channel from the service. */
export function registerProviderHandlers(router: IpcRouter, service: ProviderService): void {
  router.handle('providers:list', () => service.list())
  router.handle('providers:detect', () => service.detect())
  router.handle('providers:connect', ({ provider }) => service.connect(provider))
  router.handle('providers:cancelConnect', ({ provider }) => service.cancelConnect(provider))
  router.handle('providers:disconnect', ({ provider }) => service.disconnect(provider))
  router.handle('providers:setApiKey', ({ provider, key }) => service.setApiKey(provider, key))
  router.handle('providers:models', ({ provider }) => service.models(provider))
  router.handle('providers:select', ({ provider }) => service.select(provider))
  router.handle('providers:setModel', ({ provider, model }) => service.setModel(provider, model))
  router.handle('providers:chooseCliPath', ({ provider }) => service.chooseCliPath(provider))
  router.handle('providers:resetCliPath', ({ provider }) => service.resetCliPath(provider))
}
