/**
 * A static file server, and nothing else.
 *
 * LiveHand is a progressive web app: the whole hand-entry engine and all three
 * exporters run in the browser, so a player can type a hand at a table with no
 * signal and still get their text, image and replayer out. This server exists
 * only to hand the files over during development and, if you host it, in
 * production too — there is no API, no database and no account.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PORT = Number(process.argv[2] || process.env.PORT || 4180);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};

/**
 * `web/` is the site root, but the app imports the engine straight out of
 * `src/`, so those two trees are both reachable and nothing else is.
 */
function resolveRequest(pathname) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  if (clean === '/' || clean === '') return join(ROOT, 'web', 'index.html');
  if (clean.startsWith('/src/')) return join(ROOT, clean);
  if (clean.startsWith('/out/')) return join(ROOT, clean);
  return join(ROOT, 'web', clean);
}

const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);
    const filePath = resolveRequest(pathname);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const info = await stat(filePath);
    const target = info.isDirectory() ? join(filePath, 'index.html') : filePath;
    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': TYPES[extname(target)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`LiveHand running at http://localhost:${PORT}`);
});
