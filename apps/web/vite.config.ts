import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Keep VITE_API_BASE_URL in the repository-root .env.local, as documented.
  envDir: '../../',
})
