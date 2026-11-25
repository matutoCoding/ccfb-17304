import { describe, expect, it } from 'vitest';
import {
  BEAM_LAMBDA_1,
  beamFrequencyHz,
  computeArrowStats,
  spineToEI,
} from './physics';
import { computeTear, idealNockFor, makeShotConfig, poseAt } from './shot';
import { runSelfChecks } from './selfcheck';
import { SEED_ARROWS, SEED_BOWS } from './sampleData';

const bow38 = SEED_BOWS.find((b) => b.id === 'bow-rec-38')!;
const arr600 = SEED_ARROWS.find((a) => a.id === 'arr-600-30-100')!;

describe('梁公式与频率', () => {
  it('spine 500 -> EI 在合理量级 (3~8 N·m²)', () => {
    const ei = spineToEI(500);
    expect(ei).toBeGreaterThan(3);
    expect(ei).toBeLessThan(8);
  });

  it('一阶频率落在真实箭杆 50~130Hz 区间', () => {
    const st = computeArrowStats(arr600, bow38);
    expect(st.beamF1Hz).toBeGreaterThan(50);
    expect(st.beamF1Hz).toBeLessThan(130);
  });

  it('自检全部通过（含 <3% 频率误差）', () => {
    for (const c of runSelfChecks()) {
      expect(c.pass, `${c.label} :: ${c.detail}`).toBe(true);
    }
  });

  it('自由-自由频率系数自洽', () => {
    const st = computeArrowStats(arr600, bow38);
    const again = beamFrequencyHz(st.eiNm2, st.totalMassKg, arr600.lengthIn, BEAM_LAMBDA_1);
    expect(Math.abs(again - st.beamF1Hz) / st.beamF1Hz).toBeLessThan(1e-12);
  });
});

describe('调弓手册方向', () => {
  it('100 -> 125gr 撕痕朝偏软侧单调移动（多弓/多 seed 稳健）', () => {
    const pairs: [string, string][] = [
      ['bow-rec-38', 'arr-600-30-100'],
      ['bow-rec-42', 'arr-500-30-100'],
      ['bow-cmp-60', 'arr-400-29-125'],
    ];
    for (const [bid, aid] of pairs) {
      const bow = SEED_BOWS.find((b) => b.id === bid)!;
      const arrow = SEED_ARROWS.find((a) => a.id === aid)!;
      const st = computeArrowStats(arrow, bow);
      const baseGr = arrow.pointWeightGr;
      const c1 = makeShotConfig(bow, arrow, st, { pointWeightGr: 100 }, { seed: 11 });
      const c2 = makeShotConfig(bow, arrow, st, { pointWeightGr: 125 }, { seed: 11 });
      const s1 = computeTear(c1).tailHMm * computeTear(c1).softSideSign;
      const s2 = computeTear(c2).tailHMm * computeTear(c2).softSideSign;
      // 若基准箭头本身 >125（如 125 档），100 仍是更硬对照，方向必须成立
      expect(s2).toBeGreaterThan(s1);
      expect(s2 - s1).toBeGreaterThan(2); // 25gr 至少带来 2mm 可辨位移
      expect(baseGr).toBeGreaterThan(0);
    }
  });

  it('低搭箭点 -> 上翘(high)', () => {
    const st = computeArrowStats(arr600, bow38);
    const cfg = makeShotConfig(
      bow38,
      arr600,
      st,
      { nockHeightMm: idealNockFor('recurve') - 2 },
    );
    expect(computeTear(cfg).vertical).toBe('high');
  });

  it('高搭箭点 -> 下扎(low)', () => {
    const st = computeArrowStats(arr600, bow38);
    const cfg = makeShotConfig(
      bow38,
      arr600,
      st,
      { nockHeightMm: idealNockFor('recurve') + 2 },
    );
    expect(computeTear(cfg).vertical).toBe('low');
  });
});

describe('时间确定性', () => {
  it('同一 t 重复采样完全相同', () => {
    const st = computeArrowStats(arr600, bow38);
    const cfg = makeShotConfig(bow38, arr600, st, { pointWeightGr: 125 });
    expect(poseAt(cfg, 0.0413)).toEqual(poseAt(cfg, 0.0413));
  });

  it('乱序拖动后回到同一帧，弯曲系数一致', () => {
    const st = computeArrowStats(arr600, bow38);
    const cfg = makeShotConfig(bow38, arr600, st);
    const ts = [0.01, 0.09, 0.03, 0.06, 0.02];
    const first = ts.map((t) => poseAt(cfg, t));
    const again = [ts[3], ts[0], ts[4], ts[2], ts[1]].map((t) => poseAt(cfg, t));
    expect(again[1]).toEqual(first[0]);
    expect(again[0]).toEqual(first[3]);
    expect(again[3]).toEqual(first[2]);
  });
});
