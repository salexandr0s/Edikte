// pdfjs-dist ships no types for its worker build. The raster page only hands
// the module to pdf.js's main-thread worker hook.
declare module 'pdfjs-dist/build/pdf.worker.min.mjs' {
  export const WorkerMessageHandler: unknown
}
