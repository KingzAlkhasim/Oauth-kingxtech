import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './lib/webmcp.js'
import App from './App.jsx'

// KingxTech PWA + legacy API bridge. One service worker owns the root scope.
if ('serviceWorker' in navigator) {
  const api = encodeURIComponent(import.meta.env.VITE_API_BASE_URL || '')
  navigator.serviceWorker.register(`/sw.js?api=${api}`, { updateViaCache: 'none' }).catch(() => {})
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
