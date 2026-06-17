import { Routes, Route, Navigate } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import CaseWizard from './pages/CaseWizard'
import CaseWizardV2 from './pages/CaseWizardV2'
import CaseDetail from './pages/CaseDetail'
import ReportView from './pages/ReportView'
import CpvCatalog from './pages/CpvCatalog'
import AtecoCatalog from './pages/AtecoCatalog'
import IstatCatalog from './pages/IstatCatalog'
import TolCatalog from './pages/TolCatalog'
import Dlgs36Page from './pages/Dlgs36Page'
import SettingsPage from './pages/SettingsPage'
import Layout from './components/Layout'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/cases/:id" element={<CaseDetail />} />
        <Route path="/cases/:id/wizard/:step" element={<CaseWizard />} />
        <Route path="/cases/:id/wizard-v2" element={<CaseWizardV2 />} />
        <Route path="/cases/:id/report" element={<ReportView />} />
        <Route path="/catalogs/cpv" element={<CpvCatalog />} />
        <Route path="/catalogs/ateco" element={<AtecoCatalog />} />
        <Route path="/catalogs/istat" element={<IstatCatalog />} />
        <Route path="/catalogs/tol" element={<TolCatalog />} />
        <Route path="/dlgs36" element={<Dlgs36Page />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
