/**
 * Assemble the deployable site into dist/.
 *
 * There is no bundler and nothing is compiled — this only flattens the two
 * source trees into the shape a static host serves:
 *
 *   web/*  ->  dist/*        the app shell
 *   src/*  ->  dist/src/*    the engine and exporters the shell imports
 *
 * which is the same shape server.js presents during development, so a module
 * specifier that resolves locally resolves identically once deployed. Every
 * import is relative, so the result works whether it is served from a domain
 * root (Vercel) or a project subpath (GitHub Pages).
 */

import { cp, rm, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
await cp(resolve(ROOT, 'web'), DIST, { recursive: true });
await cp(resolve(ROOT, 'src'), resolve(DIST, 'src'), { recursive: true });

console.log(`built ${DIST}`);
