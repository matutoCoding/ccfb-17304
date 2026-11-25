// 李先生整套纸靶调试过程的种子数据：低搭箭点 + 125gr 偏软起步，
// 逐步 抬搭箭点 -> 移箭台/调侧垫 -> 换 100gr -> 微调收敛。
import type { TuneSession, TuneStep, TuneParams } from './types';
import { SEED_ARROWS, SEED_BOWS } from './sampleData';
import { computeArrowStats } from './physics';
import { computeTear, detectContacts, makeShotConfig } from './shot';
import { adviseForShot } from './diagnose';

export function buildDemoSession(): TuneSession {
  const bow = SEED_BOWS.find((b) => b.id === 'bow-rec-42')!;
  const arrow = SEED_ARROWS.find((a) => a.id === 'arr-500-30-100')!;
  const stats = computeArrowStats(arrow, bow);
  const t0 = Date.UTC(2026, 10, 8, 2, 0, 0);

  const defs: {
    title: string;
    note: string;
    params: TuneParams;
    changes: string[];
    photoId?: string;
    chaos: number;
  }[] = [
    {
      title: '初始纸靶（客户原设置）',
      note: '口子明显上翘，同时横向左撕；客户一直用 125gr 箭头。',
      params: { nockHeightMm: 1.4, restCenterMm: 1.6, plungerPressure: 42, pointWeightGr: 125 },
      changes: [],
      photoId: 'photo-nock-low',
      chaos: 0.3,
    },
    {
      title: '抬搭箭点 +1.8mm',
      note: '分 4 次、每次 0.5mm 抬到 3.2mm，上翘基本消失，横撕仍在。',
      params: { nockHeightMm: 3.2, restCenterMm: 1.6, plungerPressure: 42, pointWeightGr: 125 },
      changes: ['搭箭点 1.4 → 3.2 mm（+1.8）'],
      chaos: 0.22,
    },
    {
      title: '箭台左移 + 侧垫加压',
      note: '箭台按 1/64in 两格向左，弹性柱 42 → 52，横撕收窄但 125gr 仍偏软。',
      params: { nockHeightMm: 3.2, restCenterMm: 0.8, plungerPressure: 52, pointWeightGr: 125 },
      changes: ['箭台中心 1.6 → 0.8 mm', '弹性柱压力 42 → 52 格'],
      chaos: 0.18,
    },
    {
      title: '箭头 125 → 100gr',
      note: '横向偏软的根因是前端过重，换回 100gr 后动态 spine 回到匹配区，略偏硬侧。',
      params: { nockHeightMm: 3.2, restCenterMm: 0.4, plungerPressure: 54, pointWeightGr: 100 },
      changes: ['箭头重量 125 → 100 gr（−25）'],
      photoId: 'photo-soft',
      chaos: 0.14,
    },
    {
      title: '微调收尾 · 接近圆孔',
      note: '搭箭点回 3.0、箭台与侧垫归零位，连续三组圆孔，推 18/30m 验证。',
      params: { nockHeightMm: 3.0, restCenterMm: 0, plungerPressure: 50, pointWeightGr: 100 },
      changes: ['搭箭点 3.2 → 3.0 mm', '箭台 0.4 → 0 mm', '侧垫 54 → 50 格'],
      photoId: 'photo-clean',
      chaos: 0.05,
    },
  ];

  const steps: TuneStep[] = defs.map((d, i) => {
    const cfg = makeShotConfig(bow, arrow, stats, d.params, { chaos: d.chaos, seed: 1000 + i * 37 });
    const tear = computeTear(cfg);
    const advices = adviseForShot(cfg, tear, d.params);
    const contactCount = detectContacts(cfg).length;
    return {
      id: `step-${i}`,
      at: t0 + i * 1000 * 60 * 18,
      title: d.title,
      note: d.note,
      params: { ...d.params },
      arrowId: arrow.id,
      tear,
      contactCount,
      advices,
      photoId: d.photoId,
      changes: d.changes,
    };
  });

  return {
    id: 'session-lsx',
    customerName: '李先生',
    bowId: bow.id,
    arrowId: arrow.id,
    createdAt: t0,
    updatedAt: t0 + 4 * 1000 * 60 * 18,
    steps,
  };
}
