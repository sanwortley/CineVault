import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .catch(err => console.error('[PWA] Fallo al registrar Service Worker:', err))
    })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
    <App />
)
