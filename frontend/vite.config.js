import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { fileURLToPath } from 'node:url'
import { detectMiddleware } from './server/gemini_detect.js'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))

// `npm run dev`       the app on this laptop, http://localhost:5173
// `npm run dev:wifi`  the same over Wi-Fi with HTTPS, so a phone can open it
//                     and use the camera scanner (WebXR needs HTTPS)
//
// The phone cannot reach the backend's http://localhost:5000, and an HTTPS
// page may not call plain HTTP anyway, so every /api call goes to this dev
// server, which passes it on to the backend. Same for /uploads (avatars).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const wifi = mode === 'wifi'
  const toBackend = {
    target: 'http://localhost:5000',
    changeOrigin: true,
    // the backend's CORS list only knows localhost origins; a proxied call
    // is same-origin for the browser, so drop the header
    configure: (proxy) => proxy.on('proxyReq', (proxyReq) => proxyReq.removeHeader('origin')),
  }
  return {
    plugins: [
      react(),
      tailwindcss(),
      // the scanner's "Guess from camera": Gemini, with the key from .env.local
      {
        name: 'gemini-detect-endpoint',
        configureServer(server) {
          server.middlewares.use('/api/detect', detectMiddleware(env))
        },
      },
      ...(wifi ? [basicSsl()] : []),
    ],
    server: {
      host: wifi ? true : undefined,
      port: 5173,
      strictPort: true,
      proxy: { '/api': toBackend, '/uploads': toBackend },
    },
    build: {
      // two pages: the React app, and the room scanner
      rollupOptions: { input: { main: here('./index.html'), scan: here('./scan.html') } },
    },
  }
})
