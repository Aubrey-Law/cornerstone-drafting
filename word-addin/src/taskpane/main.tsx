import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

Office.onReady((info) => {
  const container = document.getElementById('root')
  if (!container) throw new Error('Task pane root element #root is missing')

  if (info.host !== Office.HostType.Word) {
    container.textContent = 'Cornerstone drafting runs in Microsoft Word.'
    return
  }

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
