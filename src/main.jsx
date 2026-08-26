import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './lib/webmcp.js'
import App from './App.jsx'

// Temporary compatibility bridge: KXpertDrawer on older cached builds still
// calls the former Cloud Run origin directly. The service worker redirects
// those requests to the new Vercel backend once VITE_API_BASE_URL is set.
if ('serviceWorker' in navigator && import.meta.env.VITE_API_BASE_URL) {
  const api = encodeURIComponent(import.meta.env.VITE_API_BASE_URL)
  navigator.serviceWorker.register(`/kx-api-bridge.js?api=${api}`).catch(() => {})
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
