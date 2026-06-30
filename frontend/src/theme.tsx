import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

type Theme = 'light' | 'dark'

interface ThemeContextValue {
  theme: Theme
  isDark: boolean
  toggleTheme: () => void
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function getInitialTheme(): Theme {
  const stored = localStorage.getItem('theme')
  if (stored === 'dark' || stored === 'light') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const LIGHT_VARS: Record<string, string> = {
  '--color-bg': '#f5f6fa',
  '--color-bg-card': '#ffffff',
  '--color-bg-nav': '#1a1a2e',
  '--color-bg-nav-hover': '#2d2d4e',
  '--color-bg-input': '#ffffff',
  '--color-bg-hover': '#f3f4f6',
  '--color-bg-code': '#1e293b',
  '--color-bg-muted': '#f9fafb',
  '--color-bg-error': '#fde8e8',
  '--color-bg-success': '#d1fae5',
  '--color-bg-warning': '#fef3c7',
  '--color-bg-info': '#dbeafe',
  '--color-bg-offset': '#f9fafb',
  '--color-text-primary': '#1f2937',
  '--color-text-secondary': '#374151',
  '--color-text-muted': '#6b7280',
  '--color-text-light': '#9ca3af',
  '--color-text-inverse': '#ffffff',
  '--color-text-nav': '#ccc',
  '--color-text-footer': '#9ca3af',
  '--color-text-error': '#c0392b',
  '--color-text-success': '#065f46',
  '--color-text-warning': '#92400e',
  '--color-text-info': '#1e40af',
  '--color-text-revision-up': '#dc2626',
  '--color-text-revision-down': '#16a34a',
  '--color-border': '#d1d5db',
  '--color-border-light': '#e5e7eb',
  '--color-border-lighter': '#f3f4f6',
  '--color-border-success': '#bbf7d0',
  '--color-border-error': '#fca5a5',
  '--color-border-warning': '#fef08a',
  '--color-border-info': '#bfdbfe',
  '--color-primary': '#1a1a2e',
  '--color-primary-text': '#ffffff',
  '--color-shadow': 'rgba(0,0,0,0.1)',
  '--color-shadow-heavy': 'rgba(0,0,0,0.15)',
  '--color-overlay': 'rgba(0,0,0,0.4)',
  '--color-table-stripe': '#f9fafb',
  '--color-table-border': '#e5e7eb',
  '--color-table-header-bg': '#f9fafb',
  '--color-threshold-ok-bg': '#f0fdf4',
  '--color-threshold-ok-border': '#bbf7d0',
  '--color-threshold-ok-text': '#16a34a',
  '--color-threshold-exceeded-bg': '#fef2f2',
  '--color-threshold-exceeded-border': '#fca5a5',
  '--color-threshold-exceeded-text': '#dc2626',
}

const DARK_VARS: Record<string, string> = {
  '--color-bg': '#0f1117',
  '--color-bg-card': '#1a1d27',
  '--color-bg-nav': '#0d0f15',
  '--color-bg-nav-hover': '#1f2233',
  '--color-bg-input': '#1e2030',
  '--color-bg-hover': '#1f2233',
  '--color-bg-code': '#0d1117',
  '--color-bg-muted': '#15171f',
  '--color-bg-error': '#3b1a1a',
  '--color-bg-success': '#1a3b2a',
  '--color-bg-warning': '#3b351a',
  '--color-bg-info': '#1a2a3b',
  '--color-bg-offset': '#15171f',
  '--color-text-primary': '#e5e7eb',
  '--color-text-secondary': '#d1d5db',
  '--color-text-muted': '#9ca3af',
  '--color-text-light': '#6b7280',
  '--color-text-inverse': '#1f2937',
  '--color-text-nav': '#ccc',
  '--color-text-footer': '#6b7280',
  '--color-text-error': '#fca5a5',
  '--color-text-success': '#6ee7b7',
  '--color-text-warning': '#fbbf24',
  '--color-text-info': '#93c5fd',
  '--color-text-revision-up': '#fca5a5',
  '--color-text-revision-down': '#6ee7b7',
  '--color-border': '#374151',
  '--color-border-light': '#2d2d3d',
  '--color-border-lighter': '#1f1f2e',
  '--color-border-success': '#166534',
  '--color-border-error': '#991b1b',
  '--color-border-warning': '#854d0e',
  '--color-border-info': '#1e40af',
  '--color-primary': '#3b3b6e',
  '--color-primary-text': '#ffffff',
  '--color-shadow': 'rgba(0,0,0,0.3)',
  '--color-shadow-heavy': 'rgba(0,0,0,0.5)',
  '--color-overlay': 'rgba(0,0,0,0.6)',
  '--color-table-stripe': '#15171f',
  '--color-table-border': '#2d2d3d',
  '--color-table-header-bg': '#15171f',
  '--color-threshold-ok-bg': '#1a3b2a',
  '--color-threshold-ok-border': '#166534',
  '--color-threshold-ok-text': '#6ee7b7',
  '--color-threshold-exceeded-bg': '#3b1a1a',
  '--color-threshold-exceeded-border': '#991b1b',
  '--color-threshold-exceeded-text': '#fca5a5',
}

function varsToCss(vars: Record<string, string>): string {
  return Object.entries(vars).map(([k, v]) => `${k}: ${v};`).join('\n')
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme)

  const setTheme = (t: Theme) => {
    setThemeState(t)
    localStorage.setItem('theme', t)
  }

  const toggleTheme = () => setTheme(theme === 'light' ? 'dark' : 'light')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Listen for OS-level preference changes
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem('theme')) {
        setThemeState(e.matches ? 'dark' : 'light')
      }
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, isDark: theme === 'dark', toggleTheme, setTheme }}>
      <style>{`
        :root {
          ${varsToCss(LIGHT_VARS)}
        }
        [data-theme="dark"] {
          ${varsToCss(DARK_VARS)}
        }
        html, body, #root {
          background: var(--color-bg);
          color: var(--color-text-primary);
        }
        body {
          margin: 0;
        }
        ::selection {
          background: ${theme === 'dark' ? '#3b3b6e' : '#1a1a2e'};
          color: #fff;
        }
        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        ::-webkit-scrollbar-track {
          background: var(--color-bg);
        }
        ::-webkit-scrollbar-thumb {
          background: var(--color-border);
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: var(--color-text-light);
        }
      `}</style>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
