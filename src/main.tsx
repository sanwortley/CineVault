import { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'

function UpdateBanner() {
  const [show, setShow] = useState(false)
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    let reg: ServiceWorkerRegistration

    navigator.serviceWorker.register('/sw.js').then((r) => {
      reg = r
      setRegistration(r)

      setInterval(() => r.update(), 30 * 60 * 1000)

      r.addEventListener('updatefound', () => {
        const newSW = r.installing
        if (!newSW) return
        newSW.addEventListener('statechange', () => {
          if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
            setShow(true)
          }
        })
      })
    })

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload()
    })
  }, [])

  const handleReload = () => {
    if (registration?.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' })
    }
  }

  if (!show) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between bg-cyan-600 px-4 py-3 text-white shadow-lg">
      <span className="text-sm font-medium">Nueva versión disponible</span>
      <button
        onClick={handleReload}
        className="ml-4 rounded bg-white px-4 py-1.5 text-sm font-semibold text-cyan-600 transition-colors hover:bg-gray-100"
      >
        Recargar
      </button>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <>
    <App />
    <UpdateBanner />
  </>
)
