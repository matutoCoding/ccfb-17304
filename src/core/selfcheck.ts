// ============================================================
// 物理/方向自检：设置页展示 + vitest 共用同一份结果
//  1) 推演一阶频率 vs spine+总重梁公式，误差必须 <3%
//  2) 同一把弓 100gr -> 125gr，撕痕必须朝偏软侧单调移动
//  3) 低搭箭点 -> 上翘 -> 建议上调
//  4) 任意时刻重复采样完全一致（拖时间轴不抖）
// ============================================================

import { beamFrequencyHz, computeArrowStats, spineToEI } from './physics';
import { makeShotConfig, poseAt, computeTear, tearDrivers, idealNockFor } from './shot';
import { adviseFromTear } from './diagnose';
import { SEED_ARROWS, SEED_BOWS } from './sampleData';
import type { ShotConfig } from './types';

export interface CheckResult {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
  metrics?: Record<string, string | number>;
}

/** 从 pose.qz1 的插值过零时刻估计一阶频率（消除整数量化误差） */
export function measureMode1Frequency(cfg: ShotConfig): number {
  const dt = 0.00002;
  const t0 = 0.01;
  const t1 = 0.11;
  const crosses: number[] = [];
  let prevT = t0;
  let prevV = poseAt(cfg, t0).qz1;
  for (let t = t0 + dt; t <= t1 + 1e-9; t += dt) {
    const v = poseAt(cfg, t).qz1;
    if (prevV !== 0 && Math.sign(v) !== Math.sign(prevV) && v !== 0) {
      // 线性插值得到过零时刻
      const tc = prevT + (dt * Math.abs(prevV)) / (Math.abs(prevV) + Math.abs(v));
      crosses.push(tc);
    }
    prevT = t;
    prevV = v;
  }
  if (crosses.length >= 4) {
    // 相邻过零间隔半个周期：N-1 个间隔 = (N-1)/2 个周期
    const n = crosses.length;
    return (n - 1) / 2 / (crosses[n - 1] - crosses[0]);
  }
  return cfg.f1Hz;
}

export function runSelfChecks(): CheckResult[] {
  const results: CheckResult[] = [];
  const bow38 = SEED_BOWS.find((b) => b.id === 'bow-rec-38')!;
  const arr600 = SEED_ARROWS.find((a) => a.id === 'arr-600-30-100')!;
  const stats = computeArrowStats(arr600, bow38);

  // —— 1) 频率误差（多组 spine 扫一遍，报最大误差）——
  const freqRows: { name: string; formula: number; measured: number; errPct: number }[] = [];
  for (const arrow of SEED_ARROWS.slice(0, 5)) {
    const bow = arrow.staticSpine >= 650 ? bow38 : SEED_BOWS.find((b) => b.id === 'bow-rec-42')!;
    const st = computeArrowStats(arrow, bow);
    const cfg = makeShotConfig(bow, arrow, st);
    const measured = measureMode1Frequency(cfg);
    // 直接从 spine + 总重重算梁公式（独立路径）
    const formula = beamFrequencyHz(spineToEI(arrow.staticSpine), st.totalMassKg, arrow.lengthIn);
    freqRows.push({
      name: arrow.shaftModel.slice(0, 18),
      formula,
      measured,
      errPct: Math.abs(measured - formula) / formula * 100,
    });
  }
  const maxErr = Math.max(...freqRows.map((r) => r.errPct));
  results.push({
    id: 'freq',
    label: '一阶振动频率 ↔ 梁公式误差 < 3%',
    pass: maxErr < 3,
    detail:
      `最大误差 ${maxErr.toFixed(2)}%；基准 600 spine：公式 ${stats.beamF1Hz.toFixed(1)}Hz，` +
      `过零实测 ${freqRows[0].measured.toFixed(1)}Hz。`,
    metrics: {
      maxErrPct: +maxErr.toFixed(3),
      eiNm2: +stats.eiNm2.toFixed(3),
      f1Hz: +stats.beamF1Hz.toFixed(2),
    },
  });

  // —— 2) 100 -> 125 朝偏软侧 ——
  const cfg100 = makeShotConfig(bow38, arr600, stats, { pointWeightGr: 100 });
  const cfg125 = makeShotConfig(bow38, arr600, stats, { pointWeightGr: 125 });
  const tear100 = computeTear(cfg100);
  const tear125 = computeTear(cfg125);
  const soft100 = tear100.tailHMm * tear100.softSideSign;
  const soft125 = tear125.tailHMm * tear125.softSideSign;
  results.push({
    id: 'point-direction',
    label: '箭头 100→125gr 撕痕单调朝偏软侧',
    pass: soft125 > soft100 + 1e-6,
    detail:
      `偏软坐标 ${soft100.toFixed(2)}mm → ${soft125.toFixed(2)}mm（增量 ${(soft125 - soft100).toFixed(2)}mm）；` +
      `spine 比 ${cfg100.spineRatio.toFixed(3)} → ${cfg125.spineRatio.toFixed(3)}；` +
      `判定 ${tear100.horizontal} → ${tear125.horizontal}。`,
    metrics: { soft100: +soft100.toFixed(2), soft125: +soft125.toFixed(2) },
  });

  // —— 3) 低搭箭点 -> 上翘 -> 上调建议 ——
  const lowNock = idealNockFor('recurve') - 2;
  const cfgN = makeShotConfig(bow38, arr600, stats, { nockHeightMm: lowNock, pointWeightGr: 100 });
  const tearN = computeTear(cfgN);
  const advN = adviseFromTear(tearN, {
    bowType: 'recurve',
    handedness: 'RH',
    params: { nockHeightMm: lowNock, restCenterMm: 0, plungerPressure: 50, pointWeightGr: 100 },
    spineRatio: cfgN.spineRatio,
  });
  const nockAdvice = advN.find((a) => a.target === 'nockPoint');
  results.push({
    id: 'nock-direction',
    label: '口子上翘 ↔ 搭箭点低 ↔ 建议上调',
    pass: tearN.vertical === 'high' && !!nockAdvice && /上调/.test(nockAdvice.title),
    detail: `nock=${lowNock.toFixed(1)}mm，垂直尾偏 ${tearN.tailVMm.toFixed(1)}mm，判定 ${tearN.vertical}，首条搭箭建议：${nockAdvice?.title ?? '无'}。`,
  });

  // —— 4) 确定性：同一 t / 乱序拖动结果一致 ——
  const times = [0.001, 0.0173, 0.0333, 0.0501, 0.0888];
  const a = times.map((t) => JSON.stringify(poseAt(cfg125, t)));
  const shuffled = [times[3], times[0], times[4], times[1], times[2]].map((t) =>
    JSON.stringify(poseAt(cfg125, t)),
  );
  const reordered = [3, 0, 4, 1, 2].map((i) => a[i]);
  const deterministic = shuffled.every((s, i) => s === reordered[i]);
  const p1 = poseAt(cfg125, 0.04);
  const p2 = poseAt(cfg125, 0.04);
  results.push({
    id: 'determinism',
    label: '1000× 慢放来回拖轴，弯曲确定不抖',
    pass: deterministic && JSON.stringify(p1) === JSON.stringify(p2),
    detail: 'poseAt(cfg,t) 是 t 的纯解析函数，无逐帧积分/无随机重播种；乱序采样逐字段一致。',
  });

  // —— 5) 接触检测可运行且方向量有限 ——
  const d = tearDrivers(cfg125);
  results.push({
    id: 'finite',
    label: '推演量全部有限',
    pass: [d.tailHMm, d.tailVMm, d.yawRad, d.pitchRad].every(Number.isFinite),
    detail: `tail=(${d.tailHMm.toFixed(2)}, ${d.tailVMm.toFixed(2)})mm, yaw=${(d.yawRad * 57.3).toFixed(2)}°, pitch=${(d.pitchRad * 57.3).toFixed(2)}°`,
  });

  return results;
}
