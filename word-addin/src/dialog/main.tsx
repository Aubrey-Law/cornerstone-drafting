import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '../taskpane/styles.css'

/**
 * Mount immediately. Do NOT wait for Office.
 *
 * The task pane's entry waits on `Office.onReady` because it cannot read a
 * document without it. The dialog can: it needs Office only at the very end, to
 * call `messageParent`, and `resolveMessageParent` waits for that itself with a
 * deadline. Gating the whole page on Office readiness is precisely what left
 * the old dialog on a frozen first paint with nothing to click.
 */
const container = document.getElementById('root')
if (!container) throw new Error('Dialog root element #root is missing')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
