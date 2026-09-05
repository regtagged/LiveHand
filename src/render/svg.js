/**
 * Scene -> SVG. Used for the on-screen preview and the .svg download; the PNG
 * path goes through the canvas backend instead so that text rasterises with
 * the same font metrics the layout assumed.
 */

import { SUIT_COLOR, SUIT_GLYPH } from '../core/cards.js';
import { FONT } from './scene.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

function roundRect(x, y, w, h, r, attrs) {
  return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="${r}" ${attrs}/>`;
}

/** A card as GG draws it in a share sheet: a solid suit-coloured tile. */
function solidCard(node) {
  const { x, y, w, h, card } = node;
  const color = SUIT_COLOR[card.suit];
  const rankSize = h * 0.62;
  const pipSize = h * 0.34;
  return [
    roundRect(x, y, w, h, Math.max(3, w * 0.14), `fill="${color}"`),
    `<text x="${(x + w * 0.42).toFixed(2)}" y="${(y + h * 0.72).toFixed(2)}" font-family="${FONT}" font-size="${rankSize.toFixed(1)}" font-weight="700" fill="#fff" text-anchor="middle">${escape(card.rank)}</text>`,
    `<text x="${(x + w * 0.84).toFixed(2)}" y="${(y + h * 0.36).toFixed(2)}" font-family="${FONT}" font-size="${pipSize.toFixed(1)}" fill="#fff" text-anchor="middle">${SUIT_GLYPH[card.suit]}</text>`,
  ].join('');
}

/** A card as a client draws it on the felt: white face, coloured rank and pip. */
function faceCard(node) {
  const { x, y, w, h, card } = node;
  const color = SUIT_COLOR[card.suit];
  const rankSize = h * 0.42;
  const pipSize = h * 0.36;
  return [
    roundRect(x, y, w, h, Math.max(3, w * 0.12), 'fill="#fdfdfb" stroke="#c9c9c4" stroke-width="1"'),
    `<text x="${(x + w * 0.5).toFixed(2)}" y="${(y + h * 0.46).toFixed(2)}" font-family="${FONT}" font-size="${rankSize.toFixed(1)}" font-weight="700" fill="${color}" text-anchor="middle">${escape(card.rank)}</text>`,
    `<text x="${(x + w * 0.5).toFixed(2)}" y="${(y + h * 0.86).toFixed(2)}" font-family="${FONT}" font-size="${pipSize.toFixed(1)}" fill="${color}" text-anchor="middle">${SUIT_GLYPH[card.suit]}</text>`,
  ].join('');
}

function nodeToSvg(node) {
  switch (node.type) {
    case 'rect': {
      const stroke = node.stroke ? ` stroke="${node.stroke}" stroke-width="${node.strokeWidth || 1}"` : '';
      return roundRect(node.x, node.y, node.w, node.h, node.rx || 0, `fill="${node.fill}"${stroke}`);
    }
    case 'line':
      return `<line x1="${node.x1.toFixed(2)}" y1="${node.y1.toFixed(2)}" x2="${node.x2.toFixed(2)}" y2="${node.y2.toFixed(2)}" stroke="${node.stroke}" stroke-width="${node.width}"/>`;
    case 'ellipse': {
      const stroke = node.stroke ? ` stroke="${node.stroke}" stroke-width="${node.strokeWidth || 1}"` : '';
      return `<ellipse cx="${node.cx.toFixed(2)}" cy="${node.cy.toFixed(2)}" rx="${node.rx.toFixed(2)}" ry="${node.ry.toFixed(2)}" fill="${node.fill}"${stroke}/>`;
    }
    case 'text': {
      const anchor = node.anchor === 'start' ? '' : ` text-anchor="${node.anchor}"`;
      const italic = node.italic ? ' font-style="italic"' : '';
      return `<text x="${node.x.toFixed(2)}" y="${node.y.toFixed(2)}" font-family="${node.family}" font-size="${node.size}" font-weight="${node.weight}" fill="${node.fill}"${anchor}${italic}>${escape(node.text)}</text>`;
    }
    case 'richtext': {
      // One <text> with a <tspan> per run: the SVG engine advances each tspan
      // by its real width, so styled runs on a line can never overlap.
      const spans = node.runs.map((run) => {
        const italic = run.italic ? ' font-style="italic"' : '';
        const size = run.size && run.size !== node.size ? ` font-size="${run.size}"` : '';
        return `<tspan fill="${run.fill}" font-weight="${run.weight}"${size}${italic}` +
          ` xml:space="preserve">${escape(run.text)}</tspan>`;
      }).join('');
      return `<text x="${node.x.toFixed(2)}" y="${node.y.toFixed(2)}" font-family="${FONT}" font-size="${node.size}">${spans}</text>`;
    }
    case 'card':
      return node.variant === 'face' ? faceCard(node) : solidCard(node);
    default:
      return '';
  }
}

export function sceneToSvg(scene) {
  const body = scene.nodes.map(nodeToSvg).join('\n  ');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}">`,
    `  <rect width="${scene.width}" height="${scene.height}" fill="${scene.background}"/>`,
    `  ${body}`,
    '</svg>',
  ].join('\n');
}
