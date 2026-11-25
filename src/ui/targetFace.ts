// 18/30m 靶面：同心圆 + 裸杆/带羽两组弹着与组心。
import type { ImpactGroup } from '../core/types';

export function drawTargetFace(
  canvas: HTMLCanvasElement,
  groups: ImpactGroup[],
  opts: { radiusMm?: number } = {},
): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = canvas.clientWidth || 420;
  const size = cssW;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const W = size;
  const cx = W / 2;
  const cy = W / 2;
  const Rpx = W / 2 - 14;
  const worldR = opts.radiusMm ?? 360;
  const s = Rpx / worldR;

  ctx.clearRect(0, 0, W, W);
  // 靶纸底
  ctx.beginPath();
  ctx.arc(cx, cy, Rpx + 8, 0, Math.PI * 2);
  ctx.fillStyle = '#f4f1e6';
  ctx.fill();

  // 环（10 环制，每环 worldR/10）
  for (let ring = 10; ring >= 1; ring--) {
    const r = (worldR * ring) / 10;
    ctx.beginPath();
    ctx.arc(cx, cy, r * s, 0, Math.PI * 2);
    const isGold = ring >= 9;
    const isRed = ring >= 7 && ring <= 8;
    const isBlue = ring >= 5 && ring <= 6;
    ctx.fillStyle = isGold ? '#f2b441' : isRed ? '#e8544f' : isBlue ? '#3f7fd6' : ring >= 3 ? '#222' : '#f4f1e6';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  // 环号
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  for (let ring = 9; ring >= 1; ring -= 2) {
    const r = (worldR * (ring + 0.5)) / 10;
    ctx.fillText(String(11 - ring), cx, cy - r * s + 3);
  }

  // 十字
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.moveTo(cx, cy - Rpx);
  ctx.lineTo(cx, cy + Rpx);
  ctx.moveTo(cx - Rpx, cy);
  ctx.lineTo(cx + Rpx, cy);
  ctx.stroke();
  ctx.setLineDash([]);

  const mapX = (hMm: number) => cx + hMm * s;
  const mapY = (vMm: number) => cy - vMm * s;

  for (const g of groups) {
    const color = g.kind === 'bare' ? '#ff5d5d' : '#19c7e6';
    // 弹着
    for (const im of g.impacts) {
      ctx.beginPath();
      if (g.kind === 'bare') {
        // X 形裸杆
        const x = mapX(im.hMm);
        const y = mapY(im.vMm);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.moveTo(x - 5, y - 5);
        ctx.lineTo(x + 5, y + 5);
        ctx.moveTo(x + 5, y - 5);
        ctx.lineTo(x - 5, y + 5);
        ctx.stroke();
      } else {
        ctx.arc(mapX(im.hMm), mapY(im.vMm), 4.2, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.stroke();
      }
    }
    // 组心
    ctx.beginPath();
    ctx.arc(mapX(g.centerHMm), mapY(g.centerVMm), 8, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mapX(g.centerHMm) - 12, mapY(g.centerVMm));
    ctx.lineTo(mapX(g.centerHMm) + 12, mapY(g.centerVMm));
    ctx.moveTo(mapX(g.centerHMm), mapY(g.centerVMm) - 12);
    ctx.lineTo(mapX(g.centerHMm), mapY(g.centerVMm) + 12);
    ctx.stroke();
  }
}
