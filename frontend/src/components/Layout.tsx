import { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTheme } from '../theme'
import pkg from '../../package.json'

declare const __BUILD_DATE__: string
const AUTHOR = 'Walter Tosolini'

export default function Layout({ children }: { children: ReactNode }) {
  const { isDark, toggleTheme } = useTheme()
  const loc = useLocation()
  const isActive = (p: string) => loc.pathname === p ? 'active' : ''

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', minHeight: '100vh',
      background: 'var(--color-bg)', fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <nav style={{
        background: 'var(--color-bg-nav)', color: '#fff', padding: '0 24px',
        display: 'flex', alignItems: 'center', height: 56, gap: 16,
        overflowX: 'auto', flexShrink: 0,
      }}>
        <Link to="/" style={{ color: '#fff', textDecoration: 'none', fontWeight: 700, fontSize: 18, whiteSpace: 'nowrap' }}>
          Revisione Prezzi
        </Link>
        <Link to="/" className={isActive('/')} style={{ color: 'var(--color-text-nav)', textDecoration: 'none', fontSize: 14, whiteSpace: 'nowrap' }}>
          Dashboard
        </Link>
        <Link to="/catalogs/cpv" className={isActive('/catalogs/cpv')} style={{ color: 'var(--color-text-nav)', textDecoration: 'none', fontSize: 14, whiteSpace: 'nowrap' }}>
          Catalogo CPV
        </Link>
        <Link to="/catalogs/ateco" className={isActive('/catalogs/ateco')} style={{ color: 'var(--color-text-nav)', textDecoration: 'none', fontSize: 14, whiteSpace: 'nowrap' }}>
          Catalogo ATECO
        </Link>
        <Link to="/catalogs/istat" className={isActive('/catalogs/istat')} style={{ color: 'var(--color-text-nav)', textDecoration: 'none', fontSize: 14, whiteSpace: 'nowrap' }}>
          Indici ISTAT
        </Link>
        <Link to="/catalogs/tol" className={isActive('/catalogs/tol')} style={{ color: 'var(--color-text-nav)', textDecoration: 'none', fontSize: 14, whiteSpace: 'nowrap' }}>
          Tabelle TOL
        </Link>
        <Link to="/dlgs36" className={isActive('/dlgs36')} style={{ color: 'var(--color-text-nav)', textDecoration: 'none', fontSize: 14, whiteSpace: 'nowrap' }}>
          DLGS 36 2023
        </Link>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={isDark ? 'Passa a tema chiaro' : 'Passa a tema scuro'}
          style={{
            marginLeft: 'auto',
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: '#ccc', fontSize: 18, padding: '4px 8px',
            display: 'flex', alignItems: 'center', gap: 6,
            fontFamily: 'inherit',
          }}
        >
          {isDark ? '☀️' : '🌙'}
        </button>

        <Link to="/settings" className={isActive('/settings')} style={{ color: 'var(--color-text-nav)', textDecoration: 'none', fontSize: 14, whiteSpace: 'nowrap' }}>
          Impostazioni
        </Link>
      </nav>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 24px 48px', width: '100%', flex: 1 }}>
        {children}
      </main>

      <footer style={{
        background: 'var(--color-bg-nav)', color: 'var(--color-text-footer)', padding: '12px 24px',
        textAlign: 'center', fontSize: 12, borderTop: '1px solid var(--color-border-lighter)',
      }}>
        Revisione Prezzi v{pkg.version} del {__BUILD_DATE__} &mdash; Autore: {AUTHOR}
      </footer>
    </div>
  )
}
