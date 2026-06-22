import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function buildDate(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

export default defineConfig({
  define: {
    __BUILD_DATE__: JSON.stringify(buildDate()),
  },
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://backend:8000',
      '/health': 'http://backend:8000',
    },
  },
})
