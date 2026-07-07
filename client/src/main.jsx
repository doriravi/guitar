import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import PWAPrompt from './components/PWAPrompt.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <PWAPrompt />
  </StrictMode>,
)
