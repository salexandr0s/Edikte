import { contextBridge, ipcRenderer } from 'electron'
import {
  RASTER_CHANNELS,
  type PdfRasterApi,
  type RasterDone,
  type RasterPageResult,
} from '../main/documents/raster-channels'

// Preload of the hidden window that renders scanned Gutachten pages with
// pdf.js (src/renderer/pdf-raster/). It forwards three calls and nothing else;
// main checks the sender and validates every payload.

const api: PdfRasterApi = {
  getJob: () => ipcRenderer.invoke(RASTER_CHANNELS.job) as Promise<unknown>,
  sendPage: async (result: RasterPageResult) => {
    await ipcRenderer.invoke(RASTER_CHANNELS.page, result)
  },
  finish: async (result: RasterDone) => {
    await ipcRenderer.invoke(RASTER_CHANNELS.done, result)
  },
}

contextBridge.exposeInMainWorld('pdfRaster', api)
