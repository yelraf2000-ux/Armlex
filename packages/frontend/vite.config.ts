import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Everything under /api goes to Fastify, so the app is same-origin in dev.
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        configure: (proxy) => {
          // Without this, an unreachable backend produces an empty 500 body and
          // the browser reports "Unexpected end of JSON input" — which points at
          // the wrong layer entirely. Answer with real JSON instead.
          proxy.on('error', (err, _req, res) => {
            const body = JSON.stringify({
              error: 'backend unreachable on http://127.0.0.1:3001',
              detail: `${err.message}. Запустите «npm run dev» в корне проекта — он поднимает API и фронтенд вместе.`,
            });
            if ('writeHead' in res && !res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
            }
            if ('end' in res) res.end(body);
          });
        },
      },
    },
  },
});
