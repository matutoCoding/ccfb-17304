// ============================================================
// 合成“客户实射纸靶照片”：
// 先在平整纸画布上画程序化裂口，再用条带双线性 warp 出透视，
// 叠加光照不均、噪点、暗角，最后回算透视后的箭头孔/撕痕像素坐标，
// 作为一键填入的 groundTruth 标注。
// ============================================================

import type { PhotoMarks, PhotoRecord, TearReport } from '../core/types';
import { computeArrowStats } from '../core/physics';
import { computeTear, makeShotConfig } from '../core/shot';
import { SEED_ARROWS, SEED_BOWS } from '../core/sampleData';
import { drawPaperTear } from '../ui/tearDraw';
import { mulberry32 } from '../core/rng';

const PHOTO_W = 1000;
const PHOTO_H = 760;
const PAPER_W = 1000;
const PAPER_H = 1000;
const PAPER_WIDTH_MM = 600;

interface Quad {
  tl: [number, number];
  tr: [number, number];
  br: [number, number];
  bl: [number, number];
}

/** 轻微透视 + 斜放的纸张四角（成品照片坐标） */
const QUAD: Quad = {
  tl: [268, 96],
  tr: [824, 66],
  br: [892, 676],
  bl: [214, 706],
};

function bilinear(q: Quad, u: number, v: number): [number, number] {
  const topX = q.tl[0] + (q.tr[0] - q.tl[0]) * u;
  const topY = q.tl[1] + (q.tr[1] - q.tl[1]) * u;
  const botX = q.bl[0] + (q.br[0] - q.bl[0]) * u;
  const botY = q.bl[1] + (q.br[1] - q.bl[1]) * u;
  return [topX + (botX - topX) * v, topY + (botY - topY) * v];
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function buildPaperCanvas(tears: { tear: TearReport; u: number; v: number; scale?: number }[]): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(PAPER_W, PAPER_H);
  // 纸基
  const g = ctx.createLinearGradient(0, 0, PAPER_W, PAPER_H);
  g.addColorStop(0, '#f3eedd');
  g.addColorStop(0.55, '#ece5d0');
  g.addColorStop(1, '#e2d8bf');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, PAPER_W, PAPER_H);

  // 纸纤维/斑点
  const rnd = mulberry32(20261126);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * PAPER_W;
    const y = rnd() * PAPER_H;
    ctx.fillStyle = `rgba(120,100,70,${0.02 + rnd() * 0.05})`;
    ctx.fillRect(x, y, 1 + rnd() * 2, 1);
  }
  // 折痕
  ctx.strokeStyle = 'rgba(150,130,95,0.18)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAPER_W * 0.5, 0);
  ctx.lineTo(PAPER_W * 0.52, PAPER_H);
  ctx.stroke();

  const pxPerMm = PAPER_W / PAPER_WIDTH_MM;
  for (const item of tears) {
    ctx.save();
    ctx.translate(item.u * PAPER_W, item.v * PAPER_H);
    ctx.scale(item.scale ?? 1, item.scale ?? 1);
    drawPaperTear(ctx, item.tear, 0, 0, pxPerMm);
    ctx.restore();
  }
  return c;
}

/** 条带透视 warp */
function warpPaper(ctx: CanvasRenderingContext2D, paper: HTMLCanvasElement, q: Quad): void {
  const strips = 64;
  for (let i = 0; i < strips; i++) {
    const u0 = i / strips;
    const u1 = (i + 1) / strips;
    const sx0 = Math.floor(u0 * PAPER_W);
    const sx1 = Math.ceil(u1 * PAPER_W) + 1; // 重叠 1px 防缝
    const Q00 = bilinear(q, u0, 0);
    const Q10 = bilinear(q, u1, 0);
    const Q01 = bilinear(q, u0, 1);

    ctx.save();
    ctx.beginPath();
    const a = bilinear(q, u0, 0);
    const b = bilinear(q, u1, 0);
    const cc = bilinear(q, u1, 1);
    const d = bilinear(q, u0, 1);
    ctx.moveTo(...a);
    ctx.lineTo(...b);
    ctx.lineTo(...cc);
    ctx.lineTo(...d);
    ctx.closePath();
    ctx.clip();

    const sw = sx1 - sx0;
    const aa = (Q10[0] - Q00[0]) / sw;
    const bb = (Q10[1] - Q00[1]) / sw;
    const ccc = (Q01[0] - Q00[0]) / PAPER_H;
    const dd = (Q01[1] - Q00[1]) / PAPER_H;
    const e = Q00[0] - aa * sx0;
    const f = Q00[1] - bb * sx0;
    ctx.setTransform(aa, bb, ccc, dd, e, f);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(paper, 0, 0);
    ctx.restore();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function paintBackground(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createLinearGradient(0, 0, 0, PHOTO_H);
  g.addColorStop(0, '#4a4034');
  g.addColorStop(0.5, '#332c22');
  g.addColorStop(1, '#211c15');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, PHOTO_W, PHOTO_H);
  // 木板横向纹理
  const rnd = mulberry32(777);
  for (let y = 0; y < PHOTO_H; y += 96) {
    ctx.fillStyle = `rgba(0,0,0,${0.18 + rnd() * 0.12})`;
    ctx.fillRect(0, y, PHOTO_W, 3);
    ctx.fillStyle = `rgba(255,220,170,${0.03 + rnd() * 0.03})`;
    ctx.fillRect(0, y + 3, PHOTO_W, 2);
  }
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = `rgba(0,0,0,${rnd() * 0.08})`;
    ctx.fillRect(rnd() * PHOTO_W, rnd() * PHOTO_H, 2 + rnd() * 30, 1);
  }
}

function paintLightingAndNoise(ctx: CanvasRenderingContext2D): void {
  // 不均暖光（左上）
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const warm = ctx.createRadialGradient(PHOTO_W * 0.3, PHOTO_H * 0.22, 40, PHOTO_W * 0.3, PHOTO_H * 0.22, 720);
  warm.addColorStop(0, 'rgba(255,226,178,0.5)');
  warm.addColorStop(1, 'rgba(255,226,178,0)');
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, PHOTO_W, PHOTO_H);
  ctx.restore();

  // 右侧冷阴影
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  const cool = ctx.createLinearGradient(PHOTO_W * 0.55, 0, PHOTO_W, 0);
  cool.addColorStop(0, 'rgba(255,255,255,1)');
  cool.addColorStop(1, 'rgba(120,135,170,0.72)');
  ctx.fillStyle = cool;
  ctx.fillRect(0, 0, PHOTO_W, PHOTO_H);
  ctx.restore();

  // 噪点
  const img = ctx.getImageData(0, 0, PHOTO_W, PHOTO_H);
  const data = img.data;
  const rnd = mulberry32(424242);
  for (let i = 0; i < data.length; i += 4) {
    const n = (rnd() - 0.5) * 22;
    data[i] += n;
    data[i + 1] += n;
    data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);

  // 暗角
  const v = ctx.createRadialGradient(PHOTO_W / 2, PHOTO_H / 2, 260, PHOTO_W / 2, PHOTO_H / 2, 760);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, PHOTO_W, PHOTO_H);
}

function addCaption(ctx: CanvasRenderingContext2D, text: string): void {
  ctx.save();
  ctx.font = '600 26px "Microsoft YaHei", sans-serif';
  ctx.fillStyle = 'rgba(255,244,220,0.85)';
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 6;
  ctx.fillText(text, 40, PHOTO_H - 34);
  ctx.restore();
}

function makeGroundTruth(tear: TearReport, u = 0.5, v = 0.5): PhotoMarks {
  const point = bilinear(QUAD, u, v);
  const topW = Math.hypot(QUAD.tr[0] - QUAD.tl[0], QUAD.tr[1] - QUAD.tl[1]);
  const botW = Math.hypot(QUAD.br[0] - QUAD.bl[0], QUAD.br[1] - QUAD.bl[1]);
  const mmPerPx = PAPER_WIDTH_MM / ((topW + botW) / 2);
  // 与诊断页同一“单尺度仿射反算”口径：直接用物理尾偏回推像素，保证标注反算一致
  const tearPxX = point[0] + tear.tailHMm / mmPerPx;
  const tearPxY = point[1] - tear.tailVMm / mmPerPx;
  return {
    pointPx: { x: Math.round(point[0]), y: Math.round(point[1]) },
    tearPx: { x: Math.round(tearPxX), y: Math.round(tearPxY) },
    extraTearsPx: [],
    shooterView: true,
    paperWidthMm: PAPER_WIDTH_MM,
    imageWidthPx: PHOTO_W,
    mmPerPx,
  };
}

export function generateSamplePhotos(): PhotoRecord[] {
  const bow = SEED_BOWS.find((b) => b.id === 'bow-rec-38')!;
  const arrow = SEED_ARROWS.find((a) => a.id === 'arr-600-30-100')!;
  const stats = computeArrowStats(arrow, bow);
  const now = Date.UTC(2026, 0, 20);

  const scenarios: {
    id: string;
    name: string;
    tags: string[];
    caption: string;
    tears: { tear: TearReport; u: number; v: number }[];
    gtIndex: number;
    at: number;
  }[] = [];

  const mkTear = (params: Parameters<typeof makeShotConfig>[3], chaos = 0.12, seed = 7) =>
    computeTear(makeShotConfig(bow, arrow, stats, params, { chaos, seed }));

  const clean = mkTear({ nockHeightMm: 3.1, restCenterMm: 0, plungerPressure: 50, pointWeightGr: 100 }, 0.04, 11);
  const nockLow = mkTear({ nockHeightMm: 1.0, restCenterMm: 0.2, plungerPressure: 50, pointWeightGr: 100 }, 0.16, 22);
  const soft = mkTear({ nockHeightMm: 3.2, restCenterMm: 0, plungerPressure: 50, pointWeightGr: 125 }, 0.14, 33);
  const messy = mkTear({ nockHeightMm: 0.6, restCenterMm: 1.4, plungerPressure: 38, pointWeightGr: 125 }, 0.9, 44);

  scenarios.push({
    id: 'photo-clean',
    name: '样片A · 接近圆孔（调校到位）',
    tags: ['圆孔', '合格'],
    caption: '11/08  2m  第4组  接近圆孔',
    tears: [{ tear: clean, u: 0.5, v: 0.5 }],
    gtIndex: 0,
    at: now,
  });
  scenarios.push({
    id: 'photo-nock-low',
    name: '样片B · 口子上翘（搭箭点低）',
    tags: ['上翘', '搭箭点'],
    caption: '11/08  2m  李先生  初始  上翘',
    tears: [{ tear: nockLow, u: 0.5, v: 0.48 }],
    gtIndex: 0,
    at: now + 1,
  });
  scenarios.push({
    id: 'photo-soft',
    name: '样片C · 横向偏软撕痕（125gr）',
    tags: ['横撕', '偏软', '箭头重量'],
    caption: '11/12  2m  125gr  横向左撕',
    tears: [{ tear: soft, u: 0.52, v: 0.52 }],
    gtIndex: 0,
    at: now + 2,
  });
  scenarios.push({
    id: 'photo-messy',
    name: '样片D · 新手散乱多孔',
    tags: ['新手', '杂乱'],
    caption: '11/15  2m  体验客户  撒放不稳定',
    tears: [
      { tear: messy, u: 0.5, v: 0.5 },
      { tear: nockLow, u: 0.34, v: 0.38 },
      { tear: soft, u: 0.66, v: 0.62 },
    ],
    gtIndex: 0,
    at: now + 3,
  });

  return scenarios.map((s) => {
    const [photo, pctx] = makeCanvas(PHOTO_W, PHOTO_H);
    paintBackground(pctx);
    const paper = buildPaperCanvas(s.tears);
    warpPaper(pctx, paper, QUAD);
    paintLightingAndNoise(pctx);
    addCaption(pctx, s.caption);
    const gt = makeGroundTruth(s.tears[s.gtIndex].tear, s.tears[s.gtIndex].u, s.tears[s.gtIndex].v);
    return {
      id: s.id,
      name: s.name,
      kind: 'sample',
      createdAt: s.at,
      dataUrl: photo.toDataURL('image/jpeg', 0.82),
      width: PHOTO_W,
      height: PHOTO_H,
      groundTruth: gt,
      tags: s.tags,
    } satisfies PhotoRecord;
  });
}
