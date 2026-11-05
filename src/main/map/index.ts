import type { CustomScheme, Session } from 'electron'
import { TILE_SCHEME } from '@shared/map'
import { createTileServer, type TileServerOptions } from './tile-protocol'

/** Registered in main's single registerSchemesAsPrivileged call before the app is ready. */
export const TILE_SCHEME_PRIVILEGES: CustomScheme = {
  scheme: TILE_SCHEME,
  privileges: { standard: true, secure: true, stream: true },
}

/** Serves map tiles to the renderer's session. Call once, after the app is ready. */
export function installTileProtocol(target: Session, options: TileServerOptions): void {
  const server = createTileServer(options)
  target.protocol.handle(TILE_SCHEME, (request) => server.serve(request))
}

export {
  createTileServer,
  parseTileUrl,
  tileFilePath,
  upstreamTileUrl,
  type Tile,
  type TileServer,
  type TileServerOptions,
} from './tile-protocol'
