// ============================================================
// 18m / 30m 远距落点：简化外弹道 + 种子化射手散布
// 裸杆几乎不纠正初始攻角，带羽箭以时间常数衰减攻角。
// ============================================================

import type { ImpactGroup, ShotConfig } from './types';
import { tearDrivers } from './shot';
import { gaussianPair, mulberry32 } from './rng';

const G = 9.81;
const DRAG_K = 0.0042; // dv/dt = -k v²

interface FlightResult {
  tS: number;
  crossWindMm: number;
  dropMm: number;
}

/** 数值积分到指定距离，返回飞行时间与横向/高低偏移 */
function flyToDistance(
  speed0: number,
  distanceM: number,
  angle0Rad: number,
  tauStabilizeS: number,
  dt = 0.002,
): FlightResult {
  let x = 0;
  let v = speed0;
  let t = 0;
  let lateral = 0;
  let vertical = 0;
  let angle = angle0Rad;
  while (x < distanceM && t < 3) {
    v = Math.max(20, v - DRAG_K * v * v * dt);
    angle *= Math.exp(-dt / tauStabilizeS);
    x += v * dt;
    lateral += v * Math.sin(angle) * dt;
    // 重力下坠（相对瞄准线）
    vertical -= 0.5 * G * dt * dt + G * t * dt;
    t += dt;
  }
  return { tS: t, crossWindMm: lateral * 1000, dropMm: vertical * 1000 };
}

export function simulateGroup(
  cfg: ShotConfig,
  distanceM: 18 | 30,
  kind: 'bare' | 'fletched',
  count = 6,
  seedSalt = 0,
): ImpactGroup {
  const { yawRad, pitchRad } = tearDrivers(cfg);
  const rnd = mulberry32((cfg.seed ^ (distanceM * 7919) ^ (kind === 'bare' ? 0xbabe : 0xf1ec) ^ seedSalt) >>> 0);

  // 裸杆稳定时间常数很长，带羽很短
  const tau = kind === 'bare' ? 1.6 : 0.11;
  // 每发初始角散布（rad），新手 chaos 放大
  const sigma = (kind === 'bare' ? 0.0016 : 0.00085) * (0.6 + cfg.chaos * 2.2);

  // 用平均初始攻角算系统偏移
  const baseH = flyToDistance(cfg.v0Mps, distanceM, yawRad, tau).crossWindMm;
  const baseV = flyToDistance(cfg.v0Mps, distanceM, pitchRad, tau).crossWindMm; // pitch uses same integrator axis
  const nominalDrop = flyToDistance(cfg.v0Mps, distanceM, 0, tau).dropMm;

  const impacts: { hMm: number; vMm: number }[] = [];
  for (let i = 0; i < count; i++) {
    const [nh, nv] = gaussianPair(rnd);
    const yawI = yawRad + nh * sigma;
    const pitchI = pitchRad + nv * sigma;
    const h = flyToDistance(cfg.v0Mps, distanceM, yawI, tau).crossWindMm;
    const vLat = flyToDistance(cfg.v0Mps, distanceM, pitchI, tau).crossWindMm;
    const drop = flyToDistance(cfg.v0Mps, distanceM, pitchI, tau).dropMm - nominalDrop;
    impacts.push({
      hMm: +h.toFixed(1),
      // 瞄准具已补偿名义下坠；保留俯仰横向积分与微小残差
      vMm: +(vLat + drop * 0.15).toFixed(1),
    });
  }

  const centerHMm = mean(impacts.map((i) => i.hMm));
  const centerVMm = mean(impacts.map((i) => i.vMm));
  const radii = impacts.map((i) => Math.hypot(i.hMm - centerHMm, i.vMm - centerVMm));
  const meanRadiusMm = mean(radii);
  let groupSizeMm = 0;
  for (let i = 0; i < impacts.length; i++)
    for (let j = i + 1; j < impacts.length; j++)
      groupSizeMm = Math.max(groupSizeMm, Math.hypot(impacts[i].hMm - impacts[j].hMm, impacts[i].vMm - impacts[j].vMm));

  return {
    distanceM,
    kind,
    impacts,
    centerHMm: +centerHMm.toFixed(1),
    centerVMm: +centerVMm.toFixed(1),
    meanRadiusMm: +meanRadiusMm.toFixed(1),
    groupSizeMm: +groupSizeMm.toFixed(1),
  };
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
}
