import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles/globals.css'

// Register Service Worker for PWA with cache busting
// Unregister any existing SW first to fix stale SW issues on Safari
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
        registrations.forEach(reg => reg.unregister());
    }).catch(() => {});
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js?v=' + Date.now())
            .catch(err => console.error('[PWA] Fallo al registrar Service Worker:', err));
    });
}

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)
