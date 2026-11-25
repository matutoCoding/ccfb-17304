// ============================================================
// 出箭推演核心 —— 全部是时间 t 的确定性纯函数
//
// 坐标：x 顺箭飞行（朝靶），y 上，z = 射手视角右侧。
// 纸面坐标 h=z（射手侧视图向右），v=y。
//
// 方向约定（与店内《白纸调弓土办法》及标准 paper-tune 对照）：
//   · nock 低于理想值 -> tailV>0 -> 口子“上翘” -> 建议上调搭箭点
//   · 右手弓(RH) 偏软 -> tailH<0（尾左）；左手弓镜像
//   · 100gr -> 125gr 箭头：spineRatio 增大，softCoord 单调增大（朝偏软侧）
// ============================================================

import type {
  ArrowPose,
  BowProfile,
  ArrowProfile,
  ArrowStats,
  ContactEvent,
  FlapSpec,
  Handedness,
  ShotConfig,
  TearReport,
  TuneParams,
} from './types';
import { BEAM_LAMBDA_1, BEAM_LAMBDA_2 } from './physics';
import { mulberry32 } from './rng';

export const T_END_S = 0.12; // 高速推演窗口
export const REST_X_M = 0.02; // 箭台/弓窗所在 x

const DEG = 180 / Math.PI;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** 弦距 m（握把到弦） */
export function braceM(cfg: ShotConfig): number {
  return cfg.braceHeightIn * 0.0254;
}
/** 拉程 m = 拉距 - 弦距 */
export function strokeM(cfg: ShotConfig): number {
  return clamp((cfg.drawLengthIn - cfg.braceHeightIn) * 0.0254, 0.3, 0.62);
}
/** t=0 满弓时箭尾（弦扣）x：弦距位置再往后一个拉程 */
export function nockX0(cfg: ShotConfig): number {
  return -(braceM(cfg) + strokeM(cfg));
}
export function tipX0(cfg: ShotConfig): number {
  return nockX0(cfg) + cfg.arrowLengthIn * 0.0254;
}
/** 离弦时刻：匀加速且末速度=v0，拉程 = 0.5·v0·T */
export function powerS(cfg: ShotConfig): number {
  return (2 * strokeM(cfg)) / cfg.v0Mps;
}

export const handSign = (h: Handedness): 1 | -1 => (h === 'RH' ? 1 : -1);
/** +h 纸面方向是不是“偏软侧”：RH 软在左(-h) => -1 */
export const softSideSign = (h: Handedness): 1 | -1 => (h === 'RH' ? -1 : 1);

// —— 校准增益（mm / 物理单位），集中在此便于与手册对照 ——
const K_SOFT_MM = 78; // 每 1.0 spineRatio 偏差的水平尾偏
const K_REST_MM = 3.2; // 箭台中心每偏 1mm -> 尾偏
const K_PLUNGER_MM = 0.22; // 侧垫压力每格 -> 尾偏
const K_NOCK_MM = 5.2; // 搭箭点每偏 1mm -> 垂直尾偏（符号按店约）

export function idealNockFor(bowType: string): number {
  // 反曲指撒通常“高平方 1/8~1/4 in”≈ +3mm；复合 D-loop 近水平
  return bowType === 'recurve' ? 3.0 : 0.5;
}
export function idealRestFor(): number {
  return 0;
}
export function idealPlungerFor(): number {
  return 50;
}

export function makeShotConfig(
  bow: BowProfile,
  arrow: ArrowProfile,
  stats: ArrowStats,
  params?: Partial<TuneParams>,
  opts?: { paperDistanceM?: number; chaos?: number; seed?: number },
): ShotConfig {
  const p: TuneParams = {
    nockHeightMm: params?.nockHeightMm ?? bow.nockHeightMm,
    restCenterMm: params?.restCenterMm ?? bow.restCenterMm,
    plungerPressure: params?.plungerPressure ?? bow.plungerPressure,
    pointWeightGr: params?.pointWeightGr ?? arrow.pointWeightGr,
  };
  // 若 what-if 改了箭头重量，按比例修正总重与频率（EI 不变，μ 变）
  let totalGr = stats.totalWeightGr;
  let f1 = stats.beamF1Hz;
  let f2 = stats.beamF2Hz;
  let spineRatio = stats.spineRatio;
  if (p.pointWeightGr !== arrow.pointWeightGr) {
    const dGr = p.pointWeightGr - arrow.pointWeightGr;
    totalGr += dGr;
    const massRatio = stats.totalWeightGr / totalGr; // μ0/μ
    f1 *= Math.sqrt(massRatio);
    f2 *= Math.sqrt(massRatio);
    // 动态 spine 的箭头配重因子变化
    const fPoint = (pw: number) => 0.55 + 0.0045 * (pw + arrow.insertWeightGr * 0.35);
    spineRatio *= fPoint(p.pointWeightGr) / fPoint(arrow.pointWeightGr);
  }

  return {
    seed: opts?.seed ?? hashCfg(bow.id, arrow.id, p.pointWeightGr),
    bowType: bow.bowType,
    handedness: bow.handedness,
    releaseStyle: bow.bowType === 'recurve' ? 'fingers' : 'caliper',
    drawWeightLb: bow.drawWeightLb,
    drawLengthIn: bow.drawLengthIn,
    braceHeightIn: bow.braceHeightIn,
    letOffPct: bow.letOffPct ?? 75,
    arrowLengthIn: arrow.lengthIn,
    totalWeightGr: totalGr,
    eiNm2: stats.eiNm2,
    f1Hz: f1,
    f2Hz: f2,
    v0Mps: stats.launchSpeedMps * Math.sqrt(stats.totalWeightGr / totalGr),
    nockHeightMm: p.nockHeightMm,
    idealNockMm: idealNockFor(bow.bowType),
    restCenterMm: p.restCenterMm,
    idealRestMm: idealRestFor(),
    plungerPressure: p.plungerPressure,
    idealPlunger: idealPlungerFor(),
    spineRatio,
    fletchOffsetDeg: arrow.fletchOffsetDeg + arrow.helicalDeg,
    vaneCount: arrow.fletchCount,
    vaneLengthIn: arrow.vaneLengthIn,
    vaneHeightMm: arrow.vaneHeightMm,
    shaftDiameterMm: (arrow.shaftDiameterIn ?? 0.28) * 25.4,
    chaos: opts?.chaos ?? 0.12,
    paperDistanceM: opts?.paperDistanceM ?? 2,
  };
}

function hashCfg(a: string, b: string, c: number): number {
  let h = 2166136261 >>> 0;
  const s = `${a}|${b}|${c}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// —— 自由-自由梁振型（CPU 接触计算与 GPU LUT 共用同一函数）——
export function freeFreeSigma(lambda: number): number {
  const ch = Math.cosh(lambda);
  const c = Math.cos(lambda);
  const sh = Math.sinh(lambda);
  const s = Math.sin(lambda);
  return (ch - c) / (sh - s);
}
const SIGMA1 = freeFreeSigma(BEAM_LAMBDA_1);
const SIGMA2 = freeFreeSigma(BEAM_LAMBDA_2);

/** 返回未归一化的 φ1,φ2；端点 ξ=0 处均为 2 */
export function freeFreeModesRaw(u: number): [number, number] {
  const x1 = BEAM_LAMBDA_1 * u;
  const p1 =
    Math.cosh(x1) + Math.cos(x1) - SIGMA1 * (Math.sinh(x1) + Math.sin(x1));
  const x2 = BEAM_LAMBDA_2 * u;
  const p2 =
    Math.cosh(x2) + Math.cos(x2) - SIGMA2 * (Math.sinh(x2) + Math.sin(x2));
  return [p1 / 2, p2 / 2];
}

// 数值归一化系数（让最大绝对幅值≈1），模块加载时算一次
function modeNorm(lambda: number, sigma: number): number {
  let m = 0;
  for (let i = 0; i <= 400; i++) {
    const u = i / 400;
    const x = lambda * u;
    const p = Math.cosh(x) + Math.cos(x) - sigma * (Math.sinh(x) + Math.sin(x));
    m = Math.max(m, Math.abs(p / 2));
  }
  return m || 1;
}
const NORM1 = modeNorm(BEAM_LAMBDA_1, SIGMA1);
const NORM2 = modeNorm(BEAM_LAMBDA_2, SIGMA2);

export function freeFreeModes(u: number): [number, number] {
  const [a, b] = freeFreeModesRaw(u);
  return [a / NORM1, b / NORM2];
}

/** 纸靶到达时刻 */
export function paperTimeS(cfg: ShotConfig): number {
  const xPaper = cfg.paperDistanceM;
  const Tp = powerS(cfg);
  const xExit = tipX0(cfg) + strokeM(cfg);
  return Tp + Math.max(0, xPaper - xExit) / cfg.v0Mps;
}

function tipXAt(cfg: ShotConfig, t: number): number {
  const x0 = tipX0(cfg);
  const Tp = powerS(cfg);
  if (t <= 0) return x0;
  if (t < Tp) {
    const a = cfg.v0Mps / Tp;
    return x0 + 0.5 * a * t * t;
  }
  const xExit = x0 + strokeM(cfg);
  return xExit + cfg.v0Mps * (t - Tp);
}

interface ModalAmps {
  az1: number;
  az2: number;
  ay1: number;
  ay2: number;
}

/** 由调校量决定的振型初始幅值（m），符号与手册方向校准 */
function modalAmplitudes(cfg: ShotConfig): ModalAmps {
  const hand = handSign(cfg.handedness);
  const spineErr = cfg.spineRatio - 1;
  const recurve = cfg.bowType === 'recurve';

  // 指撒左右蛇形大；撒放器左右小、上下为主
  const paradoxZ = recurve ? 0.03 : 0.006;
  const paradoxY = recurve ? 0.01 : 0.02;
  const softBoost = clamp(1 + 2.2 * spineErr, 0.45, 2.4);

  // 符号：与 tailH 标定保持一致的整体倾向
  // RH 软 -> tailH<0，取 az1 初始为 hand 方向并随 spineErr 调相
  const zSign = -hand; // RH: -z（左）
  const ySign = cfg.nockHeightMm - cfg.idealNockMm > 0 ? -1 : 1;

  return {
    az1: zSign * paradoxZ * softBoost,
    az2: zSign * paradoxZ * 0.28 * softBoost,
    ay1: ySign * paradoxY * (1 + Math.abs(cfg.nockHeightMm - cfg.idealNockMm) * 0.12),
    ay2: ySign * paradoxY * 0.3,
  };
}

function ring(cfg: ShotConfig, t: number, f: number): number {
  const w = 2 * Math.PI * f;
  const zeta = 0.018;
  // 快起始 + 指数衰减的纯解析脉冲响应；同一 t 永远同一值
  const onset = 1 - Math.exp(-t / 0.0025);
  return onset * Math.exp(-zeta * w * Math.max(0, t)) * Math.sin(w * t);
}

/** 系统标定的过纸尾偏（mm）与攻角（rad），是撕痕方向的唯一来源 */
export function tearDrivers(cfg: ShotConfig): {
  tailHMm: number;
  tailVMm: number;
  yawRad: number;
  pitchRad: number;
} {
  const hand = handSign(cfg.handedness);
  const spineErr = cfg.spineRatio - 1;
  const lateralScale = cfg.releaseStyle === 'fingers' ? 1 : 0.4;

  const softTerm = -hand * K_SOFT_MM * spineErr;
  const restTerm = K_REST_MM * (cfg.restCenterMm - cfg.idealRestMm);
  const plTerm = K_PLUNGER_MM * (cfg.plungerPressure - cfg.idealPlunger);
  // 指撒固有横向偏置，良好调校时被侧垫/箭台抵消；这里 ideal 处归 0
  const tailHMm = lateralScale * (softTerm + restTerm + plTerm);

  const nockErr = cfg.nockHeightMm - cfg.idealNockMm;
  const tailVMm = -K_NOCK_MM * nockErr;

  const Lmm = cfg.arrowLengthIn * 25.4;
  const yawRad = Math.asin(clamp(-tailHMm / Lmm, -0.5, 0.5));
  const pitchRad = Math.asin(clamp(-tailVMm / Lmm, -0.5, 0.5));
  return { tailHMm, tailVMm, yawRad, pitchRad };
}

/** 某一时刻箭的完整采样 */
export function poseAt(cfg: ShotConfig, t: number): ArrowPose {
  const tt = clamp(t, 0, T_END_S);
  const xTip = tipXAt(cfg, tt);
  const L = cfg.arrowLengthIn; // 内部计算用 in，最后转 m
  const Lm = L * 0.0254;
  const amps = modalAmplitudes(cfg);

  const qz1 = amps.az1 * ring(cfg, tt, cfg.f1Hz);
  const qz2 = amps.az2 * ring(cfg, tt, cfg.f2Hz);
  const qy1 = amps.ay1 * ring(cfg, tt, cfg.f1Hz);
  const qy2 = amps.ay2 * ring(cfg, tt, cfg.f2Hz);

  const { yawRad, pitchRad } = tearDrivers(cfg);
  const onset = clamp(tt / 0.006, 0, 1);
  const yaw = yawRad * onset;
  const pitch = pitchRad * onset;

  // 粘羽偏置 -> 稳定转速（rad/s），让箭慢慢转
  const beta = (cfg.fletchOffsetDeg * Math.PI) / 180;
  const rollRate = 55 * beta;
  // 初始让“主羽（cock vane）”基本朝上：第 0 片在 angle≈0（+y），两片副羽从箭台两侧过
  const roll = rollRate * tt;

  const speed = tt < powerS(cfg) ? (cfg.v0Mps / powerS(cfg)) * tt : cfg.v0Mps;
  const xNock = xTip - Lm;

  return {
    t: tt,
    xTip,
    xNock,
    y: 0,
    z: 0,
    speed,
    pitch,
    yaw,
    roll,
    qy1,
    qz1,
    qy2,
    qz2,
  };
}

/** 杆上距箭尾 s∈[0,Lm] 处的横向弯曲位移 (dy,dz)，米 */
export function bendAtS(cfg: ShotConfig, pose: ArrowPose, sFromNockM: number): { dy: number; dz: number } {
  const u = clamp(sFromNockM / (cfg.arrowLengthIn * 0.0254), 0, 1);
  const [p1, p2] = freeFreeModes(u);
  return {
    dy: pose.qy1 * p1 + pose.qy2 * p2,
    dz: pose.qz1 * p1 + pose.qz2 * p2,
  };
}

/** 杆上一点的世界坐标（含刚体攻角的一阶旋转近似） */
export function shaftPointWorld(
  cfg: ShotConfig,
  pose: ArrowPose,
  sFromNockM: number,
): { x: number; y: number; z: number } {
  const Lm = cfg.arrowLengthIn * 0.0254;
  const u = sFromNockM / Lm;
  const x0 = pose.xNock + sFromNockM;
  const bend = bendAtS(cfg, pose, sFromNockM);
  // 刚体姿态：绕 z 俯仰、绕 y 偏航的小角度近似
  const rel = sFromNockM - Lm / 2;
  const x = x0 - rel * (pose.yaw * pose.yaw + pose.pitch * pose.pitch) * 0.5;
  const y = pose.y + bend.dy - rel * Math.sin(pose.pitch);
  const z = pose.z + bend.dz + rel * Math.sin(pose.yaw);
  return { x, y, z };
}

/** 第 vane 片羽在 along∈[0,1] 处羽尖/羽面的世界坐标 */
export function vanePointWorld(
  cfg: ShotConfig,
  pose: ArrowPose,
  vaneIndex: number,
  alongVane: number,
  tipFraction: number = 1,
): { x: number; y: number; z: number } {
  const Lm = cfg.arrowLengthIn * 0.0254;
  const vaneLenM = cfg.vaneLengthIn * 0.0254;
  // 羽片根部从距尾 0.02m 开始
  const sRoot = 0.02 + alongVane * vaneLenM;
  const base = shaftPointWorld(cfg, pose, sRoot);
  const angle = pose.roll + (vaneIndex * 2 * Math.PI) / cfg.vaneCount;
  const hM = (cfg.vaneHeightMm * 0.001) * tipFraction * Math.sin(Math.PI * clamp(0.15 + alongVane * 0.85, 0, 1));
  // 羽尖沿径向
  return {
    x: base.x,
    y: base.y + Math.cos(angle) * hM,
    z: base.z + Math.sin(angle) * hM,
  };
}

// —— 擦箭羽 / 擦箭台 / 撞弓窗检测（对时间固定步长采样，确定性）——
export function detectContacts(cfg: ShotConfig): ContactEvent[] {
  const events: ContactEvent[] = [];
  const dt = 0.00025;
  const tMax = paperTimeS(cfg) + 0.004;
  const restZM = cfg.restCenterMm * 0.001;
  const shaftRM = cfg.shaftDiameterMm * 0.001 * 0.5;
  const bladeTopY = -shaftRM - 0.0028; // 箭台刀片略低于杆面，留出副羽间隙
  // 侧垫按钮内缘：压力过大时按钮更贴近杆/羽
  const buttonFaceZ = restZM + (cfg.plungerPressure > 62 ? 0.004 : 0.012);
  const rnd = mulberry32(cfg.seed ^ 0x9e3779b9);

  for (let t = 0.004; t <= tMax; t += dt) {
    const pose = poseAt(cfg, t);
    for (let v = 0; v < cfg.vaneCount; v++) {
      // 沿羽长采样 6 点
      for (let a = 0; a <= 5; a++) {
        const along = a / 5;
        const p = vanePointWorld(cfg, pose, v, along, 1);

        // 1) 箭台刀片：x 经过 REST_X_M 附近，羽尖低于刀片顶且 z 落在窄刀片宽度内
        if (Math.abs(p.x - REST_X_M) < 0.012 && p.y < bladeTopY + 0.002 && Math.abs(p.z - restZM) < 0.007) {
          const sev = Math.max(0, bladeTopY + 0.002 - p.y) * 1000;
          if (sev > 1.1) {
            events.push(mkEvent(t, v, along, 'rest_blade', p, sev));
          }
        }
        // 2) 弹性柱/侧垫按钮（仅高压、羽尖真正进入按钮区）
        if (
          cfg.plungerPressure > 58 &&
          Math.abs(p.x - REST_X_M) < 0.018 &&
          Math.abs(p.y) < 0.011 &&
          p.z > buttonFaceZ &&
          p.z < buttonFaceZ + 0.009
        ) {
          events.push(mkEvent(t, v, along, 'plunger', p, 1.5 + rnd() * 1.5));
        }
        // 3) 弓窗侧壁（-z 侧窗口边界），x 在弓窗行程内
        const windowZ = restZM - 0.02;
        if (p.x > -0.03 && p.x < 0.14 && p.z < windowZ && p.y > -0.04 && p.y < 0.07) {
          events.push(mkEvent(t, v, along, 'riser_window', p, (windowZ - p.z) * 1000));
        }
      }
    }
  }
  return dedupeContacts(events);
}

function mkEvent(
  tS: number,
  vaneIndex: number,
  alongVane: number,
  target: ContactEvent['target'],
  p: { x: number; y: number; z: number },
  severityMm: number,
): ContactEvent {
  const Lm = 0; // s 由 x 近似反推不需要；这里用 along 已够定位
  return {
    tS: +tS.toFixed(5),
    vaneIndex,
    sFromNockM: 0.02 + alongVane * 2 * 0.0254,
    alongVane,
    target,
    x: p.x,
    y: p.y,
    z: p.z,
    severityMm: +severityMm.toFixed(2),
  };
}

/** 同一羽片相近时刻/位置的重复采样合并，只留最严重的若干次 */
function dedupeContacts(events: ContactEvent[]): ContactEvent[] {
  const out: ContactEvent[] = [];
  for (const e of events) {
    const dup = out.find(
      (o) =>
        o.vaneIndex === e.vaneIndex &&
        o.target === e.target &&
        Math.abs(o.tS - e.tS) < 0.002 &&
        Math.abs(o.alongVane - e.alongVane) < 0.25,
    );
    if (!dup) out.push(e);
    else if (e.severityMm > dup.severityMm) Object.assign(dup, e);
  }
  // 每片羽每个目标最多保留 1 个最重点，总数限制
  const best = new Map<string, ContactEvent>();
  for (const e of out) {
    const key = `${e.vaneIndex}-${e.target}`;
    const cur = best.get(key);
    if (!cur || e.severityMm > cur.severityMm) best.set(key, e);
  }
  return [...best.values()].sort((a, b) => a.tS - b.tS).slice(0, 8);
}

// —— 由 config 生成程序化撕痕报告（同 seed 稳定）——
export function computeTear(cfg: ShotConfig): TearReport {
  const { tailHMm, tailVMm, yawRad, pitchRad } = tearDrivers(cfg);
  const mag = Math.hypot(tailHMm, tailVMm);
  const dirH = mag < 1e-6 ? 0 : tailHMm / mag;
  const dirV = mag < 1e-6 ? 1 : tailVMm / mag;

  const attackDeg = Math.hypot(yawRad, pitchRad) * DEG;
  // 撕口长度与攻角/羽长相关：攻角经羽片力臂放大
  const leverMm = cfg.arrowLengthIn * 25.4 * 0.82;
  const angleLen = Math.tan(Math.min(0.4, Math.hypot(yawRad, pitchRad))) * leverMm;
  const lengthMm = clamp(9 + angleLen * 1.05 + mag * 0.25, 8, 95);
  const widthMm = clamp(cfg.shaftDiameterMm * 1.15 + mag * 0.12, 4, 26);

  const rnd = mulberry32(cfg.seed);
  const raggedness = clamp(0.2 + cfg.chaos * 0.65 + Math.min(0.35, mag / 60), 0.15, 1);

  // 翻起纸片（数量/尺寸随裂口与散乱度温和增长）
  const flaps: FlapSpec[] = [];
  const flapCount = 3 + Math.floor(rnd() * 3) + Math.round(cfg.chaos * 3);
  const baseAngle = Math.atan2(dirV, dirH);
  for (let i = 0; i < flapCount; i++) {
    const side: -1 | 1 = rnd() > 0.5 ? 1 : -1;
    flaps.push({
      angle: baseAngle + (rnd() - 0.5) * 1.5 + side * (0.5 + rnd() * 0.9),
      at: 0.1 + rnd() * 0.85,
      lengthMm: 2 + rnd() * (3.5 + lengthMm * 0.16),
      widthMm: 1.5 + rnd() * 3,
      curl: 0.5 + rnd() * 1.1,
      side,
      shade: 0.75 + rnd() * 0.25,
    });
  }

  // 每片羽的小撕痕（随滚转角分布）
  const vaneTears = [];
  for (let i = 0; i < cfg.vaneCount; i++) {
    const a = (cfg.seed % 360) * 0 + (i * 360) / cfg.vaneCount + cfg.fletchOffsetDeg * 0.4;
    vaneTears.push({
      angleDeg: a,
      lengthMm: clamp(lengthMm * (0.25 + rnd() * 0.35), 3, 30),
      widthMm: 1.5 + rnd() * 2.5,
    });
  }

  const sgn = softSideSign(cfg.handedness);
  const softCoord = tailHMm * sgn; // >0 朝偏软侧
  const vertical: TearReport['vertical'] =
    Math.abs(tailVMm) < 2.6 ? 'none' : tailVMm > 0 ? 'high' : 'low';
  const horizontal: TearReport['horizontal'] =
    Math.abs(tailHMm) < 2.6 ? 'center' : softCoord > 0 ? 'soft' : 'stiff';

  return {
    seed: cfg.seed,
    dirH,
    dirV,
    angleDeg: (Math.atan2(dirV, dirH) * 180) / Math.PI,
    lengthMm,
    widthMm,
    yawDeg: yawRad * DEG,
    pitchDeg: pitchRad * DEG,
    tailHMm,
    tailVMm,
    raggedness,
    flaps,
    vaneTears,
    vertical,
    horizontal,
    softSideSign: sgn,
    chaos: cfg.chaos,
  };
}

/** 从照片标注反算的毫米尾偏，构造一个“实测 TearReport”骨架 */
export function tearFromMeasuredVector(
  dHMm: number,
  dVMm: number,
  handedness: Handedness,
  seed: number,
  chaos = 0.2,
): TearReport {
  const mag = Math.hypot(dHMm, dVMm);
  const dirH = mag < 1e-6 ? 0 : dHMm / mag;
  const dirV = mag < 1e-6 ? 1 : dVMm / mag;
  const rnd = mulberry32(seed);
  const flaps: FlapSpec[] = [];
  const baseAngle = Math.atan2(dirV, dirH);
  for (let i = 0; i < 4; i++) {
    const side: -1 | 1 = rnd() > 0.5 ? 1 : -1;
    flaps.push({
      angle: baseAngle + (rnd() - 0.5) * 1.4 + side * (0.5 + rnd()),
      at: 0.15 + rnd() * 0.8,
      lengthMm: 2.5 + rnd() * 6,
      widthMm: 1.5 + rnd() * 3.5,
      curl: 0.5 + rnd(),
      side,
      shade: 0.8,
    });
  }
  const sgn = softSideSign(handedness);
  const softCoord = dHMm * sgn;
  return {
    seed,
    dirH,
    dirV,
    angleDeg: (Math.atan2(dirV, dirH) * 180) / Math.PI,
    lengthMm: clamp(mag * 1.1, 8, 95),
    widthMm: clamp(6 + mag * 0.1, 4, 26),
    yawDeg: 0,
    pitchDeg: 0,
    tailHMm: dHMm,
    tailVMm: dVMm,
    raggedness: 0.5 + chaos * 0.5,
    flaps,
    vaneTears: [],
    vertical: Math.abs(dVMm) < 3 ? 'none' : dVMm > 0 ? 'high' : 'low',
    horizontal: Math.abs(dHMm) < 3 ? 'center' : softCoord > 0 ? 'soft' : 'stiff',
    softSideSign: sgn,
    chaos,
  };
}
