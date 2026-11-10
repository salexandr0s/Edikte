/**
 * Size cap for one document: a download stops there, and the PDF reader takes
 * no larger file. The constant has a module of its own so that the utility
 * process, which reads untrusted PDFs, does not load the download code.
 */
export const DEFAULT_MAX_DOCUMENT_BYTES = 60 * 1024 * 1024
