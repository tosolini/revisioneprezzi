import { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'

const APP_VERSION = '1.0.1'
const BUILD_DATE = '11/06/2026'
const AUTHOR = 'Walter Tosolini'

export default function Layout({ children }: { children: ReactNode }) {
  const loc = useLocation()
  const isActive = (p: string) => loc.pathname === p ? 'active' : ''

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', minHeight: '100vh',
      background: '#f5f6fa', fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <nav style={{
        background: '#1a1a2e', color: '#fff', padding: '0 24px',
        display: 'flex', alignItems: 'center', height: 56, gap: 24,
        overflowX: 'auto', flexShrink: 0,
      }}>
        <Link to="/" style={{ color: '#fff', textDecoration: 'none', fontWeight: 700, fontSize: 18 }}>
          Revisione Prezzi
        </Link>
        <Link to="/" className={isActive('/')} style={{ color: '#ccc', textDecoration: 'none', fontSize: 14 }}>
          Dashboard
        </Link>
        <Link to="/catalogs/cpv" className={isActive('/catalogs/cpv')} style={{ color: '#ccc', textDecoration: 'none', fontSize: 14 }}>
          Catalogo CPV
        </Link>
        <Link to="/catalogs/ateco" className={isActive('/catalogs/ateco')} style={{ color: '#ccc', textDecoration: 'none', fontSize: 14 }}>
          Catalogo ATECO
        </Link>
        <Link to="/catalogs/istat" className={isActive('/catalogs/istat')} style={{ color: '#ccc', textDecoration: 'none', fontSize: 14 }}>
          Indici ISTAT
        </Link>
        <Link to="/catalogs/tol" className={isActive('/catalogs/tol')} style={{ color: '#ccc', textDecoration: 'none', fontSize: 14 }}>
          Tabelle TOL
        </Link>
        <Link to="/dlgs36" className={isActive('/dlgs36')} style={{ color: '#ccc', textDecoration: 'none', fontSize: 14 }}>
          DLGS 36 2023
        </Link>
        <Link to="/settings" className={isActive('/settings')} style={{ color: '#ccc', textDecoration: 'none', fontSize: 14, marginLeft: 'auto' }}>
          Impostazioni
        </Link>
      </nav>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 24px 48px', width: '100%', flex: 1 }}>
        {children}
      </main>

      <footer style={{
        background: '#1a1a2e', color: '#9ca3af', padding: '12px 24px',
        textAlign: 'center', fontSize: 12, borderTop: '1px solid #2d2d4e',
      }}>
        Revisione Prezzi v{APP_VERSION} del {BUILD_DATE} &mdash; Autore: {AUTHOR}
      </footer>
    </div>
  )
}
