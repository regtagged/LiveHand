/**
 * A tiny retained scene graph shared by both image exports.
 *
 * The layouts build a list of primitives; a backend turns that list into
 * something. There are two backends — SVG (src/render/svg.js, pure string
 * building, so layouts are testable in Node) and canvas (web/canvas.js, used
 * for the PNG the user actually downloads). Going through a scene rather than
 * emitting SVG and rasterising it sidesteps the usual trap where text in an
 * SVG-to-PNG conversion re-flows or falls back to a different font.
 */

export const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
export const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// Advance widths as a fraction of font size, for a system sans face. Layout
// here is mostly line-based, so this only has to be close enough to wrap and
// to centre text inside a box.
const NARROW = new Set("iljtfrI|!.,;:'`()[]{}-/\\");
const WIDE = new Set('mwMW%@');

export function measureText(text, size, weight = 400, italic = false) {
  let units = 0;
  for (const ch of String(text)) {
    if (ch === ' ') units += 0.28;
    else if (NARROW.has(ch)) units += 0.31;
    else if (WIDE.has(ch)) units += 0.86;
    else if (ch >= '0' && ch <= '9') units += 0.56;
    else if (ch >= 'A' && ch <= 'Z') units += 0.68;
    else units += 0.53;
  }
  return units * size * (weight >= 600 ? 1.04 : 1) * (italic ? 0.99 : 1);
}

export class Scene {
  constructor({ width, background = '#ffffff', padding = 28 }) {
    this.width = width;
    this.height = 0;
    this.background = background;
    this.padding = padding;
    this.nodes = [];
  }

  add(node) {
    this.nodes.push(node);
    return node;
  }

  rect(x, y, w, h, options = {}) {
    return this.add({ type: 'rect', x, y, w, h, rx: 0, fill: '#000', ...options });
  }

  line(x1, y1, x2, y2, options = {}) {
    return this.add({ type: 'line', x1, y1, x2, y2, stroke: '#000', width: 1, ...options });
  }

  ellipse(cx, cy, rx, ry, options = {}) {
    return this.add({ type: 'ellipse', cx, cy, rx, ry, fill: '#000', ...options });
  }

  /** `y` is the text baseline. */
  text(x, y, text, options = {}) {
    return this.add({
      type: 'text', x, y, text: String(text),
      size: 16, weight: 400, fill: '#111', anchor: 'start', italic: false, family: FONT,
      ...options,
    });
  }

  card(x, y, w, h, card, options = {}) {
    return this.add({ type: 'card', x, y, w, h, card, variant: 'solid', ...options });
  }

  /** Grow the canvas so everything drawn so far fits, plus bottom padding. */
  finish(bottom) {
    this.height = Math.ceil(bottom + this.padding);
    return this;
  }
}

/**
 * Lay a sequence of styled runs out as a wrapped paragraph.
 *
 * A run is `{ text, fill, weight, italic, size }`. Line *breaks* are chosen
 * with the estimated widths above, but the words on a line are emitted as one
 * `richtext` node so the backend lays them out with real metrics — the
 * estimate only has to be good enough to pick a break, never good enough to
 * position a word, which is what stops runs from colliding mid-line.
 *
 * @returns the baseline y of the line *after* the paragraph.
 */
export function flowRuns(scene, runs, { x, y, maxWidth, size = 16, lineHeight = 1.55 }) {
  const step = size * lineHeight;
  const lines = [];
  let line = [];
  let used = 0;

  const push = (piece, width, style) => {
    const last = line[line.length - 1];
    // Merge neighbours that share a style so they render as one tspan.
    if (last && last.fill === style.fill && last.weight === style.weight && last.italic === style.italic) {
      last.text += piece;
    } else {
      line.push({ text: piece, ...style });
    }
    used += width;
  };

  for (const run of runs) {
    const style = {
      fill: run.fill || '#111',
      weight: run.weight || 400,
      italic: !!run.italic,
      size: run.size || size,
    };
    for (const word of String(run.text).split(/(\s+)/)) {
      if (word === '') continue;
      const isSpace = /^\s+$/.test(word);
      const width = measureText(word, style.size, style.weight, style.italic);
      if (isSpace) {
        if (used > 0) push(word, width, style);
        continue;
      }
      if (used > 0 && used + width > maxWidth) {
        lines.push(line);
        line = [];
        used = 0;
      }
      push(word, width, style);
    }
  }
  if (line.length) lines.push(line);

  let cursorY = y;
  for (const runsOnLine of lines) {
    scene.add({ type: 'richtext', x, y: cursorY, size, runs: runsOnLine });
    cursorY += step;
  }
  return lines.length ? cursorY : y;
}

/** Draw face-down cards — a hand deliberately not being shown. */
export function hiddenCardRow(scene, count, { x, y, size, gap = 6, variant = 'solid' }) {
  let cursorX = x;
  for (let i = 0; i < count; i++) {
    scene.card(cursorX, y, size, size * (variant === 'face' ? 1.4 : 1.08), null, { variant });
    cursorX += size + gap;
  }
  return cursorX;
}

/** Draw a row of cards left to right; returns the x just past the last one. */
export function cardRow(scene, cards, { x, y, size, gap = 6, variant = 'solid' }) {
  let cursorX = x;
  for (const card of cards) {
    if (!card) continue;
    scene.card(cursorX, y, size, size * (variant === 'face' ? 1.4 : 1.08), card, { variant });
    cursorX += size + gap;
  }
  return cursorX;
}
