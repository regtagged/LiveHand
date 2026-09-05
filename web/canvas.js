/**
 * Scene -> canvas, the path a downloaded PNG takes.
 *
 * It mirrors src/render/svg.js node for node. The duplication is deliberate:
 * rasterising the SVG instead would re-run text layout in the browser's SVG
 * engine, where a missing font or a different metric silently shifts every
 * label, and the exported image would stop matching the preview.
 */

import { SUIT_COLOR, SUIT_GLYPH } from './src/core/cards.js';
import { FONT } from './src/render/scene.js';

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function setFont(ctx, node) {
  const style = node.italic ? 'italic ' : '';
  ctx.font = `${style}${node.weight || 400} ${node.size}px ${node.family || FONT}`;
  ctx.textAlign = node.anchor === 'middle' ? 'center' : node.anchor === 'end' ? 'right' : 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = node.fill;
}

function drawCard(ctx, node) {
  const { x, y, w, h, card } = node;
  const color = SUIT_COLOR[card.suit];
  if (node.variant === 'face') {
    ctx.fillStyle = '#fdfdfb';
    roundRect(ctx, x, y, w, h, Math.max(3, w * 0.12));
    ctx.fill();
    ctx.strokeStyle = '#c9c9c4';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.font = `700 ${h * 0.42}px ${FONT}`;
    ctx.fillText(card.rank, x + w * 0.5, y + h * 0.46);
    ctx.font = `${h * 0.36}px ${FONT}`;
    ctx.fillText(SUIT_GLYPH[card.suit], x + w * 0.5, y + h * 0.86);
    return;
  }
  ctx.fillStyle = color;
  roundRect(ctx, x, y, w, h, Math.max(3, w * 0.14));
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.font = `700 ${h * 0.62}px ${FONT}`;
  ctx.fillText(card.rank, x + w * 0.42, y + h * 0.72);
  ctx.font = `${h * 0.34}px ${FONT}`;
  ctx.fillText(SUIT_GLYPH[card.suit], x + w * 0.84, y + h * 0.36);
}

/** @returns {HTMLCanvasElement} */
export function sceneToCanvas(scene, scale = 2) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(scene.width * scale);
  canvas.height = Math.ceil(scene.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = scene.background;
  ctx.fillRect(0, 0, scene.width, scene.height);

  for (const node of scene.nodes) {
    switch (node.type) {
      case 'rect':
        ctx.fillStyle = node.fill;
        roundRect(ctx, node.x, node.y, node.w, node.h, node.rx || 0);
        ctx.fill();
        if (node.stroke) {
          ctx.strokeStyle = node.stroke;
          ctx.lineWidth = node.strokeWidth || 1;
          ctx.stroke();
        }
        break;
      case 'line':
        ctx.strokeStyle = node.stroke;
        ctx.lineWidth = node.width;
        ctx.beginPath();
        ctx.moveTo(node.x1, node.y1);
        ctx.lineTo(node.x2, node.y2);
        ctx.stroke();
        break;
      case 'ellipse':
        ctx.beginPath();
        ctx.ellipse(node.cx, node.cy, node.rx, node.ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = node.fill;
        ctx.fill();
        if (node.stroke) {
          ctx.strokeStyle = node.stroke;
          ctx.lineWidth = node.strokeWidth || 1;
          ctx.stroke();
        }
        break;
      case 'text':
        setFont(ctx, node);
        ctx.fillText(node.text, node.x, node.y);
        break;
      case 'richtext': {
        // Canvas can measure exactly, so runs are advanced by real widths.
        let cursor = node.x;
        for (const run of node.runs) {
          ctx.font = `${run.italic ? 'italic ' : ''}${run.weight} ${run.size || node.size}px ${FONT}`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
          ctx.fillStyle = run.fill;
          ctx.fillText(run.text, cursor, node.y);
          cursor += ctx.measureText(run.text).width;
        }
        break;
      }
      case 'card':
        drawCard(ctx, node);
        break;
      default:
        break;
    }
  }
  return canvas;
}

export function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
