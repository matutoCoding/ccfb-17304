// ============================================================
// 纸靶裂口 Canvas 绘制：毛边 / 纤维 / 翻起纸片
// 诊断页模拟裂口、记录页双步叠加、合成实射照片共用同一套绘制。
// 坐标系：内部 translate 到孔心并翻 y，使用“毫米、y 朝上”。
// ============================================================

import type { TearReport } from '../core/types';
import { mulberry32 } from '../core/rng';

export interface TearDrawOptions {
  /** 轮廓叠加模式（调试记录对比用），只描边不写实填充 */
  outline?: boolean;
  outlineColor?: string;
  lineWidthPx?: number;
  alpha?: number;
  /** 只画主方向箭头 */
  arrowOnly?: boolean;
}

export function drawPaperTear(
  ctx: CanvasRenderingContext2D,
  tear: TearReport,
  cxPx: number,
  cyPx: number,
  pxPerMm: number,
  opts: TearDrawOptions = {},
): void {
  ctx.save();
  ctx.translate(cxPx, cyPx);
  ctx.scale(pxPerMm, -pxPerMm); // 毫米坐标，y 朝上
  ctx.globalAlpha = opts.alpha ?? 1;

  if (opts.outline) {
    drawOutline(ctx, tear, opts.outlineColor ?? '#38e1ff', (opts.lineWidthPx ?? 2) / pxPerMm);
    ctx.restore();
    return;
  }
  if (opts.arrowOnly) {
    drawArrow(ctx, tear, 2.2 / pxPerMm, opts.outlineColor ?? '#ffd166');
    ctx.restore();
    return;
  }

  const rnd = mulberry32(tear.seed);
  const L = tear.lengthMm;
  const w = tear.widthMm;
  const baseA = Math.atan2(tear.dirV, tear.dirH);

  // —— 羽片小撕痕（先画，压在主裂口下）——
  for (const vt of tear.vaneTears) {
    const a = (vt.angleDeg * Math.PI) / 180;
    drawJaggedSlit(ctx, rnd, a, vt.lengthMm, vt.widthMm * 0.5, tear.raggedness, 'rgba(28,20,16,0.55)');
  }

  // —— 主撕痕（带毛边的锯齿带）——
  drawJaggedSlit(ctx, rnd, baseA, L, w * 0.55, tear.raggedness, 'rgba(24,17,13,0.92)');
  // 反方向的短分叉
  if (rnd() > 0.35) {
    drawJaggedSlit(ctx, rnd, baseA + Math.PI + (rnd() - 0.5) * 0.5, L * (0.18 + rnd() * 0.2), w * 0.3, tear.raggedness, 'rgba(30,22,17,0.8)');
  }

  // —— 中央箭头孔：毛边焦黑圆 ——
  drawRaggedHole(ctx, rnd, w * 0.62, tear.raggedness);

  // —— 毛边纤维 ——
  drawFibers(ctx, rnd, baseA, L, w, tear.raggedness);

  // —— 翻起来的纸片 ——
  for (const f of tear.flaps) {
    drawFlap(ctx, rnd, f.at * L * 0.9, baseA, f.angle, f.lengthMm, f.widthMm, f.curl, f.side, f.shade);
  }

  // —— 新手杂乱：额外穿孔 ——
  const extra = Math.round(tear.chaos * tear.chaos * 12);
  for (let i = 0; i < extra; i++) {
    const a = rnd() * Math.PI * 2;
    const d = 10 + rnd() * L * 1.1;
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d;
    const r = 1.2 + rnd() * 2.6;
    ctx.fillStyle = `rgba(25,18,14,${0.5 + rnd() * 0.4})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.7 + rnd() * 0.6), rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawJaggedSlit(
  ctx: CanvasRenderingContext2D,
  rnd: () => number,
  angle: number,
  len: number,
  halfW: number,
  rag: number,
  fill: string,
): void {
  const seg = 9;
  const nx = Math.cos(angle + Math.PI / 2);
  const ny = Math.sin(angle + Math.PI / 2);
  const ex = Math.cos(angle);
  const ey = Math.sin(angle);
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const along = t * len;
    const taper = 1 - t * 0.85;
    const jL = (rnd() - 0.5) * halfW * rag * 1.6;
    const jR = (rnd() - 0.5) * halfW * rag * 1.6;
    const cx = ex * along;
    const cy = ey * along;
    left.push([cx + nx * (halfW * taper + jL), cy + ny * (halfW * taper + jL)]);
    right.push([cx - nx * (halfW * taper + jR), cy - ny * (halfW * taper + jR)]);
  }
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (const p of left) ctx.lineTo(p[0], p[1]);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawRaggedHole(ctx: CanvasRenderingContext2D, rnd: () => number, radius: number, rag: number): void {
  const n = 22;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = radius * (0.72 + rnd() * 0.5 * (0.4 + rag));
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  const g = ctx.createRadialGradient(0, 0, radius * 0.1, 0, 0, radius * 1.25);
  g.addColorStop(0, 'rgba(8,6,5,0.98)');
  g.addColorStop(0.7, 'rgba(30,21,15,0.95)');
  g.addColorStop(1, 'rgba(70,52,38,0.55)');
  ctx.fillStyle = g;
  ctx.fill();
}

function drawFibers(
  ctx: CanvasRenderingContext2D,
  rnd: () => number,
  baseA: number,
  len: number,
  w: number,
  rag: number,
): void {
  const count = Math.round(26 + rag * 46);
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const t = rnd();
    const along = t * len;
    const side = rnd() > 0.5 ? 1 : -1;
    const off = side * w * 0.4 * (1 - t * 0.6);
    const nx = Math.cos(baseA + Math.PI / 2);
    const ny = Math.sin(baseA + Math.PI / 2);
    const ex = Math.cos(baseA);
    const ey = Math.sin(baseA);
    const x = ex * along + nx * off;
    const y = ey * along + ny * off;
    const fa = baseA + side * (Math.PI / 2) + (rnd() - 0.5) * 1.1;
    const fl = 1.5 + rnd() * 5;
    ctx.strokeStyle = rnd() > 0.45 ? 'rgba(236,228,205,0.8)' : 'rgba(150,132,104,0.7)';
    ctx.lineWidth = 0.35 + rnd() * 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(fa) * fl, y + Math.sin(fa) * fl);
    ctx.stroke();
  }
}

function drawFlap(
  ctx: CanvasRenderingContext2D,
  rnd: () => number,
  rootAlong: number,
  baseA: number,
  angle: number,
  len: number,
  width: number,
  curl: number,
  side: -1 | 1,
  shade: number,
): void {
  const rx = Math.cos(baseA) * rootAlong;
  const ry = Math.sin(baseA) * rootAlong;
  const ex = Math.cos(angle);
  const ey = Math.sin(angle);
  const px = Math.cos(angle + Math.PI / 2) * width;
  const py = Math.sin(angle + Math.PI / 2) * width;
  const tipX = rx + ex * len * (0.7 + curl * 0.3);
  const tipY = ry + ey * len;

  // 落在纸上的投影
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.moveTo(rx + px * 0.5 + 1.2, ry + py * 0.5 - 1.2);
  ctx.lineTo(rx - px * 0.5 + 1.2, ry - py * 0.5 - 1.2);
  ctx.lineTo(tipX + 1.6, tipY - 1.6);
  ctx.closePath();
  ctx.fill();

  // 纸片本体（带一点卷曲的双色）
  const paper = Math.round(228 * shade + 27);
  ctx.fillStyle = `rgb(${paper},${Math.round(paper * 0.96)},${Math.round(paper * 0.86)})`;
  ctx.beginPath();
  ctx.moveTo(rx + px * 0.5, ry + py * 0.5);
  ctx.quadraticCurveTo(
    rx + ex * len * 0.5 + px * curl * side,
    ry + ey * len * 0.5 + py * curl * side,
    tipX + px * 0.18,
    tipY,
  );
  ctx.lineTo(rx - px * 0.5, ry - py * 0.5);
  ctx.quadraticCurveTo(
    rx + ex * len * 0.45 - px * curl * side * 0.5,
    ry + ey * len * 0.45 - py * curl * side * 0.5,
    rx + px * 0.5,
    ry + py * 0.5,
  );
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,100,74,0.55)';
  ctx.lineWidth = 0.4;
  ctx.stroke();

  // 折痕
  ctx.strokeStyle = 'rgba(160,140,110,0.6)';
  ctx.beginPath();
  ctx.moveTo(rx, ry);
  ctx.quadraticCurveTo(rx + ex * len * 0.5, ry + ey * len * 0.5 + curl * side, tipX, tipY);
  ctx.stroke();
  void rnd;
}

function drawOutline(
  ctx: CanvasRenderingContext2D,
  tear: TearReport,
  color: string,
  lwMm: number,
): void {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lwMm;
  ctx.setLineDash([2.2, 1.6]);
  ctx.beginPath();
  ctx.arc(0, 0, tear.widthMm * 0.6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  drawArrow(ctx, tear, lwMm * 1.4, color);
}

function drawArrow(ctx: CanvasRenderingContext2D, tear: TearReport, lwMm: number, color: string): void {
  const L = tear.lengthMm + 10;
  const ex = tear.dirH * L;
  const ey = tear.dirV * L;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lwMm;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  const a = Math.atan2(ey, ex);
  const hs = 5 + lwMm * 2;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - hs * Math.cos(a - 0.4), ey - hs * Math.sin(a - 0.4));
  ctx.lineTo(ex - hs * Math.cos(a + 0.4), ey - hs * Math.sin(a + 0.4));
  ctx.closePath();
  ctx.fill();
}
