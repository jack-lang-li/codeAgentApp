import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_BACKEND_TARGET || 'http://localhost:8080'
  const proxy = () => ({
    target,
    changeOrigin: true,
    // Keep the complete path and stream upstream bytes without body buffering.
    timeout: 0,
    proxyTimeout: 0,
  })
  return {
    plugins: [vue()],
    server: { port: 5173, strictPort: true, proxy: { '/api': proxy(), '/actuator': proxy() } },
    // Preview also works locally; production hosting needs its own reverse proxy.
    preview: { port: 4173, proxy: { '/api': proxy(), '/actuator': proxy() } },
  }
})
