import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { proxyUnsplash } from './api/_unsplashProxy.js'

// Serves /api/unsplash during `npm run dev` with the same logic as the Vercel
// function, reading the server-only UNSPLASH_ACCESS_KEY from .env.
function unsplashDevProxy(accessKey) {
  return {
    name: 'unsplash-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/api/unsplash', async (req, res) => {
        const query = new URL(req.url, 'http://localhost').searchParams
        const result = await proxyUnsplash(query, accessKey)
        res.writeHead(result.status, result.headers).end(result.body)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // '' prefix = load every variable, including non-VITE_ server secrets (never sent to the client).
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), unsplashDevProxy(env.UNSPLASH_ACCESS_KEY)],
    // UNSPLASH_APP_NAME is non-secret (attribution utm_source), so expose it to the client too.
    envPrefix: ['VITE_', 'UNSPLASH_APP_NAME'],
    server: {
      cors: true,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'X-Requested-With, content-type, Authorization'
      }
    }
  }
})
