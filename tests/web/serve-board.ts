import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { MOCK_BACKEND } from '../e2e/mock-backend';

/**
 * Serves the E2E build of the web board (ADR-0017) at /board/ with its real
 * CSP from site/_headers, pointed at the mock backend, plus site/ for shared
 * assets. Used by tests/web and the extension hand-off test in tests/e2e.
 */
const ROOT = resolve(import.meta.dirname, '../..');
const BUILD = join(ROOT, '.output/web-e2e');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

function boardCsp(): string {
  const headers = readFileSync(join(ROOT, 'site/_headers'), 'utf8');
  const csp = /Content-Security-Policy: (.+)$/m.exec(
    headers.slice(headers.indexOf('/board/*')),
  )?.[1];
  if (!csp) throw new Error('No board CSP');
  return csp
    .replace(/connect-src [^;]+;/, `connect-src ${MOCK_BACKEND};`)
    .replace(' upgrade-insecure-requests', '');
}

/** Starts the server on localhost; returns its origin and a close function. */
export async function serveBoard(): Promise<{ origin: string; close: () => Promise<void> }> {
  if (!existsSync(BUILD)) throw new Error('Run `npm run build:web:e2e` first.');
  const csp = boardCsp();
  const server: Server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    const file = path.startsWith('/board/')
      ? normalize(join(BUILD, path.slice('/board/'.length) || 'index.html'))
      : normalize(join(ROOT, 'site', path));
    if (!file.startsWith(BUILD) && !file.startsWith(join(ROOT, 'site'))) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = readFileSync(file);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
        'Content-Security-Policy': csp,
      });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, 'localhost', r));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    origin: `http://localhost:${String(port)}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}
