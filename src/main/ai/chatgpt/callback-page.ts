import { createHash } from 'node:crypto'

/**
 * The page the browser shows after the ChatGPT redirect. Static text in German
 * and English; nothing from the request is echoed back.
 */
export type CallbackPageState = 'received' | 'not_completed' | 'unmatched'

interface PageCopy {
  title: string
  message: string
}

const COPY: Readonly<Record<CallbackPageState, { de: PageCopy; en: PageCopy }>> = {
  received: {
    de: {
      title: 'Anmeldung empfangen',
      message: 'Edikte prüft jetzt die Verbindung zu ChatGPT. Sie können diesen Tab schließen.',
    },
    en: {
      title: 'Sign-in received',
      message: 'Edikte is checking the connection to ChatGPT. You can close this tab.',
    },
  },
  not_completed: {
    de: {
      title: 'Anmeldung nicht abgeschlossen',
      message:
        'Die Anmeldung bei ChatGPT wurde nicht abgeschlossen. Sie können es in Edikte unter Einstellungen erneut versuchen.',
    },
    en: {
      title: 'Sign-in not completed',
      message: 'The ChatGPT sign-in was not completed. You can try again in Edikte under Settings.',
    },
  },
  unmatched: {
    de: {
      title: 'Link nicht erkannt',
      message:
        'Dieser Link gehört zu keiner laufenden Anmeldung. Kehren Sie zu dem Tab zurück, in dem Sie die Anmeldung begonnen haben, oder starten Sie sie in Edikte neu.',
    },
    en: {
      title: 'Link not recognized',
      message:
        'This link does not belong to a sign-in in progress. Go back to the tab where you started, or start again in Edikte.',
    },
  },
}

// Values from the app's design tokens; the page cannot load the app's CSS.
const STYLES = [
  ':root{color-scheme:light dark;--canvas:#FAFAFA;--surface:#FFFFFF;--fg:#18181B;--muted:#52525B;--border:#E4E4E7;--ok-bg:#DCFCE7;--ok-fg:#166534;--warn-bg:#FEF3C7;--warn-fg:#92400E}',
  '@media (prefers-color-scheme:dark){:root{--canvas:#09090B;--surface:#18181B;--fg:#FAFAFA;--muted:#A1A1AA;--border:#27272A;--ok-bg:#052E16;--ok-fg:#86EFAC;--warn-bg:#451A03;--warn-fg:#FCD34D}}',
  '*{box-sizing:border-box}',
  'body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--canvas);color:var(--fg);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}',
  'main{width:100%;max-width:480px;padding:32px;background:var(--surface);border:1px solid var(--border);border-radius:14px}',
  '.badge{display:inline-block;margin:0 0 24px;padding:4px 12px;border-radius:9999px;font-size:14px;font-weight:500}',
  '.received .badge{background:var(--ok-bg);color:var(--ok-fg)}',
  '.incomplete .badge{background:var(--warn-bg);color:var(--warn-fg)}',
  'h1,h2{margin:0 0 8px;font-size:20px;font-weight:600;line-height:1.2;letter-spacing:-0.01em}',
  'p{margin:0}',
  '.message{color:var(--muted)}',
  'hr{margin:24px 0;border:0;border-top:1px solid var(--border)}',
].join('')

export const CALLBACK_PAGE_CSP = [
  "default-src 'none'",
  `style-src 'sha256-${createHash('sha256').update(STYLES).digest('base64')}'`,
  'img-src data:',
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

export function renderCallbackPage(state: CallbackPageState): string {
  const { de, en } = COPY[state]
  const tone = state === 'received' ? 'received' : 'incomplete'
  return [
    '<!doctype html>',
    '<html lang="de">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    `<title>${de.title} · Edikte</title>`,
    `<style>${STYLES}</style>`,
    '</head>',
    '<body>',
    `<main class="${tone}">`,
    '<p class="badge">Edikte · ChatGPT</p>',
    `<section lang="de"><h1>${de.title}</h1><p class="message">${de.message}</p></section>`,
    '<hr>',
    `<section lang="en"><h2>${en.title}</h2><p class="message">${en.message}</p></section>`,
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n')
}
