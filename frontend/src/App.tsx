import { ArrowLeft } from 'lucide-react'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { RefreshProvider } from './hooks/useRefresh'
import AppLayout from './layouts/AppLayout'
import Alerts from './pages/Alerts'
import Analytics from './pages/Analytics'
import DeviceDetail from './pages/DeviceDetail'
import Network from './pages/Network'
import Overview from './pages/Overview'
import SettingsPage from './pages/Settings'

export default function App() {
  return (
    <RefreshProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<Overview />} />
            <Route path="network" element={<Network />} />
            <Route path="network/devices/:id" element={<DeviceDetail />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="alerts" element={<Alerts />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<NoCarrier />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </RefreshProvider>
  )
}

/** 404 in the panel's language: an empty port with both LEDs dark. */
function NoCarrier() {
  return (
    <section className="grid min-h-[60vh] place-items-center">
      <div className="text-center">
        <span className="port mx-auto" data-link="off" data-act="off" aria-hidden="true">
          <span className="port-jack scale-150">
            <span className="led led-link" />
            <span className="led led-act" />
          </span>
        </span>
        <h2 className="numeral mt-8 text-5xl">No carrier</h2>
        <p className="mt-3 max-w-sm text-sm text-muted">Nothing is patched into this address. The page may have moved, or the link was mistyped.</p>
        <Link to="/" viewTransition className="icon-travel mt-6 inline-flex items-center gap-1.5 text-sm text-accent">
          <ArrowLeft size={14} className="travel-x-back" /> Back to the front panel
        </Link>
      </div>
    </section>
  )
}
