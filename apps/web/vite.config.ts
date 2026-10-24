import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Local dev proxy so the browser always calls same-origin /api/v1, exactly as in
// production (Firebase Hosting rewrites /api/** to the Express service on Cloud Run).
// Until Express forwards validate/generate/samples, those go straight to geometry.
// Set DEV_ROUTE_ALL_TO_API=1 once Express proxies everything.
const api = process.env.DEV_API_URL ?? 'http://localhost:8080'
const geometry = process.env.DEV_ROUTE_ALL_TO_API ? api : (process.env.DEV_GEOMETRY_URL ?? 'http://127.0.0.1:8000')

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/v1/requirements': { target: api, changeOrigin: true },
      '/api/v1/catalog': { target: api, changeOrigin: true },
      '/api/v1': { target: geometry, changeOrigin: true },
    },
  },
})
