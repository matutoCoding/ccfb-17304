// ============================================================
// 物理内核（纯函数，无 three / 无 DOM）
//  - 单位换算
//  - ATA spine -> 抗弯刚度 EI（简支梁中点挠度公式）
//  - Euler-Bernoulli 自由-自由梁一阶/二阶固有频率
//  - 总重 / FOC / 动态 spine / 配弓判定 / 初速储能
// 所有页面、3D、自检与测试都只引用这里，保证口径唯一。
// ============================================================

import type { ArrowProfile, ArrowStats, BowProfile } from './types';

export const IN_TO_MM = 25.4;
export const MM_TO_IN = 1 / 25.4;
export const IN_TO_M = 0.0254;
export const GR_TO_KG = 0.00006479891; // 1 grain
export const LBF_TO_N = 4.4482216152605;

/** ATA/AMO 静态 spine 测试条件：28in 跨距、1.94 lbf（880g）中点载荷 */
export const SPINE_TEST_SPAN_IN = 28;
export const SPINE_TEST_LOAD_LBF = 1.94;

/** 自由-自由 Euler-Bernoulli 梁特征值 βnL */
export const BEAM_LAMBDA_1 = 4.730040744862704;
export const BEAM_LAMBDA_2 = 7.853204624095838;

/**
 * 静态 spine（千分之一英寸挠度）-> 抗弯刚度 EI (N·m²)
 * 简支梁中点集中载荷： δ = F L³ / (48 EI)  =>  EI = F L³ / (48 δ)
 */
export function spineToEI(staticSpine: number): number {
  const deltaM = (staticSpine / 1000) * IN_TO_M;
  const spanM = SPINE_TEST_SPAN_IN * IN_TO_M;
  const forceN = SPINE_TEST_LOAD_LBF * LBF_TO_N;
  return (forceN * spanM ** 3) / (48 * deltaM);
}

/**
 * 按 spine 反推的 EI 与“总重/全长”等效线密度，
 * 用自由-自由梁公式计算第 n 阶固有频率。
 *
 * f_n = (β_n L)² / (2π L²) · sqrt(EI / μ)
 * μ = 总质量 / 箭长（把箭头、箭尾、箭羽等效进总线密度，
 *     正是题目要求的“按 spine 和总重用梁公式”）
 */
export function beamFrequencyHz(
  eiNm2: number,
  totalMassKg: number,
  lengthIn: number,
  lambda: number = BEAM_LAMBDA_1,
): number {
  const L = lengthIn * IN_TO_M;
  const mu = totalMassKg / L;
  return (lambda ** 2 / (2 * Math.PI * L ** 2)) * Math.sqrt(eiNm2 / mu);
}

/** 弓在指定拉距下的推荐静态 spine（经验 spine chart 拟合，供配箭对照） */
export function bowRequiredSpine(drawWeightLb: number, drawLengthIn: number, bowType: string): number {
  const base = 42000 / Math.pow(drawWeightLb, 1.15);
  const dlCorrection = Math.pow(28 / Math.max(24, drawLengthIn), 0.6);
  const typeCorrection = bowType === 'compound' ? 0.94 : 1.0;
  return base * dlCorrection * typeCorrection;
}

/**
 * 动态 spine 等效值：在静态 spine 基础上计入前端配重与箭长。
 * 箭头越重、箭越长 -> 动态值越大（越软）。
 * 100gr 为标定基准：pointFactor(100)=1。
 */
export function dynamicSpineEquivalent(staticSpine: number, pointWeightGr: number, lengthIn: number): number {
  const pointFactor = 0.55 + 0.0045 * pointWeightGr; // 100gr -> 1.00 ; 125gr -> 1.1125
  const lengthFactor = Math.pow(lengthIn / 28, 0.8);
  return staticSpine * pointFactor * lengthFactor;
}

/** FOC 与总重 */
export function computeArrowStats(arrow: ArrowProfile, bow?: BowProfile): ArrowStats {
  const shaftWeightGr = arrow.shaftGpi * arrow.lengthIn;
  const fletchWeightGr =
    arrow.fletchCount * arrow.vaneWeightGrEach + (arrow.wrapWeightGr || 0);

  const totalWeightGr =
    shaftWeightGr +
    arrow.pointWeightGr +
    arrow.insertWeightGr +
    arrow.nockWeightGr +
    arrow.fletchCount * arrow.vaneWeightGrEach +
    (arrow.wrapWeightGr || 0);

  // —— 各部件重心位置（in，从箭尾槽底起）——
  const L = arrow.lengthIn;
  const parts: { m: number; x: number }[] = [
    { m: shaftWeightGr, x: L / 2 },
    { m: arrow.pointWeightGr, x: L - 0.35 },
    { m: arrow.insertWeightGr, x: L - 1.2 },
    { m: arrow.nockWeightGr, x: 0.25 },
    { m: arrow.fletchCount * arrow.vaneWeightGrEach, x: 1.7 },
    { m: arrow.wrapWeightGr || 0, x: 2.3 },
  ];
  let moment = 0;
  for (const p of parts) moment += p.m * p.x;
  const balancePointIn = moment / totalWeightGr;
  const focPct = ((balancePointIn - L / 2) / L) * 100;

  const eiNm2 = spineToEI(arrow.staticSpine);
  const totalMassKg = totalWeightGr * GR_TO_KG;
  const beamF1Hz = beamFrequencyHz(eiNm2, totalMassKg, L, BEAM_LAMBDA_1);
  const beamF2Hz = beamFrequencyHz(eiNm2, totalMassKg, L, BEAM_LAMBDA_2);

  const dynamicSpine = dynamicSpineEquivalent(
    arrow.staticSpine,
    arrow.pointWeightGr + arrow.insertWeightGr * 0.35,
    L,
  );

  const dw = bow?.drawWeightLb ?? 40;
  const dl = bow?.drawLengthIn ?? 28;
  const type = bow?.bowType ?? 'recurve';
  const required = bowRequiredSpine(dw, dl, type);
  const spineRatio = dynamicSpine / required;

  let verdict: ArrowStats['verdict'] = 'matching';
  if (spineRatio > 1.08) verdict = 'soft';
  else if (spineRatio < 0.92) verdict = 'stiff';

  const energy = bow ? storedEnergyJ(bow) : 40;
  const eta = bow?.bowType === 'compound' ? 0.85 : 0.8;
  const launchSpeedMps = Math.sqrt((2 * energy * eta) / totalMassKg);

  return {
    shaftWeightGr,
    fletchWeightGr,
    totalWeightGr,
    totalMassKg,
    balancePointIn,
    focPct,
    eiNm2,
    beamF1Hz,
    beamF2Hz,
    dynamicSpine,
    bowRequiredSpine: required,
    spineRatio,
    verdict,
    launchSpeedMps,
    storedEnergyJ: energy,
  };
}

/**
 * 弓的储能 J。
 * 拉程 = 实际拉距 - 弦距；平均拉力占峰值比例由弓种/弓片曲线决定。
 */
export function storedEnergyJ(bow: BowProfile): number {
  const strokeIn = Math.max(6, bow.drawLengthIn - bow.braceHeightIn);
  const strokeM = strokeIn * IN_TO_M;
  const peakN = bow.drawWeightLb * LBF_TO_N;
  let avgFraction: number;
  if (bow.bowType === 'compound') {
    // 凸轮在末段进入 let-off 谷区，储能比例略低于线性
    const lo = (bow.letOffPct ?? 75) / 100;
    avgFraction = 0.74 - lo * 0.12; // 0.65 左右
  } else {
    avgFraction = recurveLimbEnergyFactor(bow.limbGrade ?? 'medium');
  }
  return peakN * strokeM * avgFraction;
}

/** 反曲弓片等级 -> 拉力曲线饱满度（平均拉力/峰值） */
export function recurveLimbEnergyFactor(grade: NonNullable<BowProfile['limbGrade']>): number {
  switch (grade) {
    case 'short':
      return 0.66; // 短弓片/硬梢，早期增重快
    case 'long':
      return 0.58; // 长弓片，曲线柔顺
    case 'medium':
    default:
      return 0.615;
  }
}

export interface DFCpoint {
  drawIn: number;
  weightLb: number;
}

/**
 * 拉力-拉距曲线（DFC）。换弓片型号/等级后曲线形状随之改变。
 * 以额定拉距、额定磅数为锚点，brace 处约为峰值的 0.45。
 */
export function drawForceCurve(bow: BowProfile): DFCpoint[] {
  const anchor = bow.ratedDrawLengthIn || 28;
  const peak = bow.limbMarkWeightLb ?? bow.drawWeightLb;
  const brace = bow.braceHeightIn;
  const grade = bow.limbGrade ?? 'medium';
  // 曲线凸性指数：短弓片更“前重”，长弓片更接近线性偏凹
  const p = grade === 'short' ? 0.82 : grade === 'long' ? 1.22 : 1.0;
  const pts: DFCpoint[] = [];
  const start = Math.max(brace - 1, anchor - 11);
  for (let d = start; d <= anchor + 3.001; d += 0.5) {
    const u = Math.min(1.08, Math.max(0, (d - brace) / (anchor - brace)));
    // brace 处 0.42 peak，之后按幂曲线升到锚点峰值，过锚点继续缓慢上升
    let w: number;
    if (u <= 1) w = peak * (0.42 + 0.58 * Math.pow(u, p));
    else w = peak * (1 + 0.12 * (u - 1) / 0.08);
    if (bow.bowType === 'compound') {
      // 复合：上升到峰值后在末 3in 跌入 let-off 谷区，持重 = peak*(1-lo)
      const lo = (bow.letOffPct ?? 75) / 100;
      if (d > anchor - 3) {
        const k = Math.min(1, Math.max(0, (d - (anchor - 3)) / 3));
        const drop = k * k * (3 - 2 * k); // smoothstep
        w = peak * (1 - lo * drop);
      }
    }
    pts.push({ drawIn: +d.toFixed(2), weightLb: +w.toFixed(2) });
  }
  return pts;
}

/** 毫米 -> 英寸 */
export const mmToIn = (mm: number) => mm * MM_TO_IN;
