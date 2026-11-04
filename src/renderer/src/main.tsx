import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App, StartupError } from './app'
import { initI18n, resolveLanguage } from './i18n'
import { errorCode, invoke } from './lib/bridge'
import './styles/app.css'

const container = document.getElementById('root')
if (container === null) throw new Error('index.html has no #root element')
const root = createRoot(container)

try {
  const [info, settings] = await Promise.all([invoke('app:getInfo'), invoke('settings:get')])
  await initI18n(resolveLanguage(settings.language, info.systemLocale))
  root.render(
    <StrictMode>
      <App info={info} initialSettings={settings} />
    </StrictMode>,
  )
  // Read by the packaged-app self-check (src/main/smoke-check.ts).
  document.documentElement.dataset.startup = 'ready'
} catch (error) {
  await initI18n(resolveLanguage('system', navigator.language))
  root.render(
    <StrictMode>
      <StartupError code={errorCode(error)} />
    </StrictMode>,
  )
  document.documentElement.dataset.startup = 'failed'
}
