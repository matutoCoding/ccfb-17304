// ============================================================
// 纸靶诊断 -> 调弓建议
// 把撕痕向量反算成搭箭点 / 箭台中心 / 弹性柱 / 箭头重量 / 箭杆硬度
// 的候选调整，并用统一的“标准微调步数”作为改动量从小到大排序。
// ============================================================

import type { Advice, Handedness, PhotoMarks, ShotConfig, TearReport, TuneParams } from './types';
import { softSideSign } from './shot';

const K_SOFT_MM = 78;
const K_REST_MM = 3.2;
const K_PLUNGER_MM = 0.22;
const K_NOCK_MM = 5.2;

/** 各调整项的一个标准步进（用于统一“改动量”口径） */
export const STEP_NOCK_MM = 0.5;
export const STEP_REST_MM = 1 / 64 * 25.4; // 0.397mm，手册常按 1/64in
export const STEP_PLUNGER = 5; // 压力刻度 5 格
export const STEP_POINT_GR = 25; // 常见箭头规格档

export function marksToVectorMm(marks: PhotoMarks): { dHMm: number; dVMm: number } | null {
  if (!marks.pointPx || !marks.tearPx) return null;
  // 优先用标定 mm/px；否则假设纸宽约占画面宽 92%
  const mmPerPx = marks.mmPerPx ?? marks.paperWidthMm / (marks.imageWidthPx * 0.92);
  let dh = (marks.tearPx.x - marks.pointPx.x) * mmPerPx;
  const dv = -(marks.tearPx.y - marks.pointPx.y) * mmPerPx;
  if (!marks.shooterView) dh = -dh; // 靶侧正面照水平镜像
  return { dHMm: dh, dVMm: dv };
}

interface AdviseCtx {
  bowType?: string;
  handedness: Handedness;
  params: TuneParams;
  spineRatio?: number;
  chaos?: number;
}

export function adviseFromTear(tear: TearReport, ctx: AdviseCtx): Advice[] {
  const out: Advice[] = [];
  const chaos = ctx.chaos ?? tear.chaos;
  const conf = clamp01(0.92 - chaos * 0.45 - (tear.vaneTears.length === 0 ? 0.1 : 0));
  const p = ctx.params;

  // —— 垂直：搭箭点 ——
  if (tear.vertical === 'high') {
    const delta = clamp(tear.tailVMm / K_NOCK_MM, 0.25, 4);
    out.push({
      id: 'nock-up',
      target: 'nockPoint',
      title: '上调搭箭点',
      direction: '搭箭点偏低，口子上翘，向上抬',
      deltaText: `+${delta.toFixed(1)} mm`,
      changeAmount: delta / STEP_NOCK_MM,
      confidence: conf,
      reason: `垂直尾偏 +${tear.tailVMm.toFixed(1)}mm（上翘），按 ${K_NOCK_MM}mm/mm 增益反算。每次抬 0.5mm 后复射。`,
      patch: { nockHeightMm: +(p.nockHeightMm + delta).toFixed(2) },
    });
  } else if (tear.vertical === 'low') {
    const delta = clamp(-tear.tailVMm / K_NOCK_MM, 0.25, 4);
    out.push({
      id: 'nock-down',
      target: 'nockPoint',
      title: '下调搭箭点',
      direction: '搭箭点偏高/箭台过高，向下压',
      deltaText: `-${delta.toFixed(1)} mm`,
      changeAmount: delta / STEP_NOCK_MM,
      confidence: conf,
      reason: `垂直尾偏 ${tear.tailVMm.toFixed(1)}mm（下扎）。每次降 0.5mm，并检查箭台是否过高。`,
      patch: { nockHeightMm: +(p.nockHeightMm - delta).toFixed(2) },
    });
    if (ctx.bowType === 'compound') {
      out.push({
        id: 'cam-timing',
        target: 'form',
        title: '检查复合轮同步',
        direction: '若连续 2 次调搭箭点无效，先查上下轮同步/缆绳干涉',
        deltaText: '0 mm',
        changeAmount: 0.4,
        confidence: 0.6,
        reason: '复合弓持续性高/低撕痕常由偏心轮不同步造成，单纯动搭箭点治标不治本。',
      });
    }
  }

  // —— 水平：箭台中心距 / 弹性柱 / 箭头重量 / 箭杆硬度 ——
  if (tear.horizontal !== 'center') {
    const sgn = softSideSign(ctx.handedness);
    const softMag = tear.tailHMm * sgn; // >0 偏软向
    const isSoft = softMag > 0;
    const absH = Math.abs(tear.tailHMm);

    // 1) 箭台中心距（最小机械改动之一）
    const restDelta = clamp(-tear.tailHMm / K_REST_MM, -3, 3);
    out.push({
      id: 'rest-center',
      target: 'restCenter',
      title: restDelta > 0 ? '箭台中心向右移' : '箭台中心向左移',
      direction: `横向撕痕 ${absH.toFixed(1)}mm，先用 1/64in 小格追`,
      deltaText: `${restDelta > 0 ? '+' : ''}${restDelta.toFixed(2)} mm`,
      changeAmount: Math.abs(restDelta) / STEP_REST_MM,
      confidence: conf * 0.8,
      reason:
        '手册建议横向撕痕先以 1/64in(0.4mm) 为一格移动箭台；若移动两格仍不收敛，说明根因在 spine，不要继续靠箭台硬救。',
      patch: { restCenterMm: +(p.restCenterMm + restDelta * 0.6).toFixed(2) }, // 一次只走反算量的 60%
    });

    // 2) 弹性柱压力（反曲）
    if (ctx.bowType !== 'compound') {
      const plDelta = clamp(-tear.tailHMm / K_PLUNGER_MM, -30, 30);
      out.push({
        id: 'plunger',
        target: 'plunger',
        title: plDelta > 0 ? '增大弹性柱压力' : '减小弹性柱压力',
        direction: isSoft ? '偏软侧撕痕：匹配更硬的侧垫响应' : '偏硬侧撕痕：放松侧垫让杆身绕过弓窗',
        deltaText: `${plDelta > 0 ? '+' : ''}${Math.round(plDelta / 5) * 5} 格`,
        changeAmount: Math.abs(plDelta) / STEP_PLUNGER,
        confidence: conf * 0.7,
        reason: `弹性柱缓冲指撒的横向激励，反算压力差约 ${plDelta.toFixed(0)} 格；每次改 5 格。`,
        patch: { plungerPressure: Math.round(clamp(p.plungerPressure + plDelta * 0.5, 0, 100)) },
      });
    }

    // 3) 箭头重量（真正改变动态 spine）
    const ratioNow = ctx.spineRatio ?? estimateRatioFromTear(tear, ctx.handedness);
    const fPoint = 0.55 + 0.0045 * p.pointWeightGr;
    const dRatioPerGr = (ratioNow * 0.0045) / fPoint;
    // 要消除的 ratio 偏差：softMag/K_SOFT_MM
    const ratioErr = softMag / K_SOFT_MM; // >0 soft
    const grDeltaRaw = -ratioErr / Math.max(1e-5, dRatioPerGr);
    // 量化到常见规格档（100/125 等，5gr 取整，25 的倍数优先）
    const grDelta = quantizePointDelta(grDeltaRaw);
    if (Math.abs(grDelta) >= 10) {
      const newGr = Math.max(50, Math.min(300, Math.round(p.pointWeightGr + grDelta)));
      out.push({
        id: 'point-weight',
        target: 'pointWeight',
        title: grDelta < 0 ? '减轻箭头（让箭变硬）' : '加重箭头（让箭变软）',
        direction: isSoft
          ? `动态 spine 偏软，箭头 ${p.pointWeightGr}→${newGr}gr，减少前端载荷`
          : `动态 spine 偏硬，箭头 ${p.pointWeightGr}→${newGr}gr，加重前端压软`,
        deltaText: `${grDelta > 0 ? '+' : ''}${newGr - p.pointWeightGr} gr`,
        changeAmount: Math.abs(newGr - p.pointWeightGr) / STEP_POINT_GR + 0.6,
        confidence: conf * 0.85,
        reason:
          '加重箭头会降低一阶频率、增大杆身弯曲，撕痕向偏软侧移动；减重相反。这是题目重点核对的方向。',
        patch: { pointWeightGr: newGr },
      });
    }

    // 4) 换箭杆 spine（改动最大，放最后）
    out.push({
      id: 'shaft-spine',
      target: 'spine',
      title: isSoft ? '换硬一号箭杆（spine 数值更小）' : '换软一号箭杆（spine 数值更大）',
      direction: isSoft ? '若减重箭头仍不够，选小 50~100 的 spine' : '若加重箭头仍不够，选大 50~100 的 spine',
      deltaText: isSoft ? 'spine −50 档' : 'spine +50 档',
      changeAmount: 3,
      confidence: conf * 0.9,
      reason: '裸杆 18m 落点偏左（右手）同样支持偏软判定；换杆是最后手段，先穷尽搭箭点/箭台/侧垫/箭头配重。',
    });
  }

  // —— 手法/散乱 ——
  if (chaos > 0.45) {
    out.push({
      id: 'form',
      target: 'form',
      title: '先稳定撒放与握弓',
      direction: '撕痕杂乱、多点发散，设备调整信号被手法噪声淹没',
      deltaText: '多射 3 组取一致撕痕',
      changeAmount: 0.2,
      confidence: 0.5,
      reason: '新手单孔撕痕随机，建议同一设置连射 3 箭、取重复出现的主方向再调。',
    });
  }

  if (out.length === 0) {
    out.push({
      id: 'keep',
      target: 'form',
      title: '保持现状，进入 18/30m 验证',
      direction: '接近圆孔，纸靶通过',
      deltaText: '0',
      changeAmount: 0,
      confidence: 0.95,
      reason: '未见显著方向性撕痕。推到 18m/30m 比较裸杆与带羽组的靶心偏差。',
    });
  }

  // 统一按改动量从小到大；改动量相同按置信度高者优先
  return out.sort((a, b) => a.changeAmount - b.changeAmount || b.confidence - a.confidence);
}

function estimateRatioFromTear(tear: TearReport, h: Handedness): number {
  const sgn = softSideSign(h);
  const err = (tear.tailHMm * sgn) / K_SOFT_MM;
  return Math.min(1.6, Math.max(0.5, 1 + err));
}

function quantizePointDelta(rawGr: number): number {
  if (Math.abs(rawGr) < 10) return 0;
  // 就近到 25gr 档，至少 25
  const mag = Math.max(25, Math.round(Math.abs(rawGr) / 25) * 25);
  return Math.sign(rawGr) * mag;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** 便捷：直接从 ShotConfig 出建议 */
export function adviseForShot(
  cfg: ShotConfig,
  tear: TearReport,
  params: TuneParams,
): Advice[] {
  return adviseFromTear(tear, {
    bowType: cfg.bowType,
    handedness: cfg.handedness,
    params,
    spineRatio: cfg.spineRatio,
    chaos: cfg.chaos,
  });
}
