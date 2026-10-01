import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The web board (ADR-0017): builds web/ into site/board/, served at
 * rolestash.com/board/. CI builds it before deploying the site. Backend
 * settings come from .env.staging (public values; the one Supabase project).
 */
const ROOT = resolve(import.meta.dirname, '..');

export default defineConfig({
  root: resolve(ROOT, 'web'),
  base: '/board/',
  envDir: ROOT,
  envPrefix: 'WXT_',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': resolve(ROOT, 'src') } },
  build: {
    // WEB_OUT lets the E2E build land outside site/ (see playwright.config.ts).
    outDir: resolve(ROOT, process.env.WEB_OUT ?? 'site/board'),
    emptyOutDir: true,
    // No inline scripts or styles: the board's CSP forbids them.
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
  },
});
