import fs from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// The dev server proxies the API so the browser talks to a single origin.
const api = process.env.VITE_API_PROXY ?? 'http://127.0.0.1:8000'

// `vite preview`: unknown app routes get the app shell with a real 404 status (the app renders "No carrier").
const ROUTES = /^\/(network(\/devices\/\d+)?|analytics|alerts|settings)?\/?$/
const spa404 = (): Plugin => ({
  name: 'spa-404',
  configurePreviewServer(server) {
    const shell = path.resolve(server.config.root, server.config.build.outDir, 'index.html')
    server.middlewares.use((req, res, next) => {
      const url = (req.url ?? '/').split('?')[0]
      if (url.startsWith('/api') || url === '/health' || url.includes('.') || ROUTES.test(url)) return next()
      res.statusCode = 404
      res.setHeader('Content-Type', 'text/html')
      res.end(fs.readFileSync(shell))
    })
  },
})

export default defineConfig({
  plugins: [react(), tailwindcss(), spa404()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': api, '/health': api },
  },
  build: { chunkSizeWarningLimit: 1000 },
  preview: { host: '127.0.0.1', port: 4173, proxy: { '/api': api, '/health': api } },
})
