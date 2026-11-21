import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const port = Number(process.env.PORT) || 5173;
const host = process.env.HOST || '127.0.0.1';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'Music Tinder',
        short_name: 'Music Tinder',
        description: 'Swipe through music recommendations.',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#08090a',
        background_color: '#08090a',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // App-shell precache only: no runtime caching for the catalog or preview hosts.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: '/index.html',
      },
      devOptions: { enabled: true, type: 'module' },
    }),
  ],
  server: { host, port, strictPort: true },
  preview: { host, port, strictPort: true },
});
