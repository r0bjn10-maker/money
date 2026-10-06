import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  build: { rollupOptions: { output: { manualChunks(moduleId: string) {
    if (moduleId.includes('/node_modules/') && moduleId.includes('/xlsx/')) return 'excel';
    if (moduleId.includes('/node_modules/') && moduleId.includes('/zod/')) return 'validation';
    if (moduleId.includes('/node_modules/') && /recharts|d3-|victory|decimal/.test(moduleId)) return 'charts';
    if (moduleId.includes('/node_modules/') && /react-dom|react\/|scheduler/.test(moduleId)) return 'react';
    if (moduleId.includes('/node_modules/') && moduleId.includes('/dexie/')) return 'database';
  } } } },
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['icon.svg', 'apple-touch-icon.png'],
    manifest: {
      name: 'Mộc · Tài chính cá nhân', short_name: 'Mộc', lang: 'vi',
      description: 'Sổ tài chính cá nhân, riêng tư và offline.',
      theme_color: '#174e3c', background_color: '#f6f7f3', display: 'standalone',
      start_url: './', scope: './',
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: 'icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
      maximumFileSizeToCacheInBytes: 4000000,
      navigateFallback: 'index.html',
      cleanupOutdatedCaches: true,
    },
  })],
});
