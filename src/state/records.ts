import type { Advice, BowProfile, ArrowProfile, TuneParams, TuneSession, TuneStep } from '../core/types';
import { computeArrowStats } from '../core/physics';
import { computeTear, detectContacts, makeShotConfig } from '../core/shot';
import { adviseForShot } from '../core/diagnose';
import { idb } from '../db/database';
import { store } from './store';
import { uid } from '../core/util';

export function describeParamDiff(prev: TuneParams | undefined, next: TuneParams): string[] {
  if (!prev) return [];
  const changes: string[] = [];
  const mm = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
  if (Math.abs(next.nockHeightMm - prev.nockHeightMm) > 0.05)
    changes.push(`搭箭点 ${prev.nockHeightMm.toFixed(1)}→${next.nockHeightMm.toFixed(1)}mm（${mm(next.nockHeightMm - prev.nockHeightMm)}）`);
  if (Math.abs(next.restCenterMm - prev.restCenterMm) > 0.05)
    changes.push(`箭台中心 ${prev.restCenterMm.toFixed(1)}→${next.restCenterMm.toFixed(1)}mm`);
  if (Math.abs(next.plungerPressure - prev.plungerPressure) > 0.5)
    changes.push(`弹性柱 ${prev.plungerPressure}→${next.plungerPressure} 格`);
  if (next.pointWeightGr !== prev.pointWeightGr)
    changes.push(`箭头 ${prev.pointWeightGr}→${next.pointWeightGr}gr（${next.pointWeightGr - prev.pointWeightGr > 0 ? '+' : ''}${next.pointWeightGr - prev.pointWeightGr}）`);
  return changes;
}

export function buildStep(input: {
  bow: BowProfile;
  arrow: ArrowProfile;
  params: TuneParams;
  chaos?: number;
  title: string;
  note?: string;
  photoId?: string;
  seed?: number;
  prevParams?: TuneParams;
}): TuneStep {
  const stats = computeArrowStats(input.arrow, input.bow);
  const cfg = makeShotConfig(input.bow, input.arrow, stats, input.params, {
    chaos: input.chaos ?? 0.12,
    seed: input.seed,
  });
  const tear = computeTear(cfg);
  const advices: Advice[] = adviseForShot(cfg, tear, input.params);
  const contactCount = detectContacts(cfg).length;
  return {
    id: uid('step'),
    at: Date.now(),
    title: input.title,
    note: input.note,
    params: { ...input.params },
    arrowId: input.arrow.id,
    tear,
    contactCount,
    advices,
    photoId: input.photoId,
    changes: describeParamDiff(input.prevParams, input.params),
  };
}

export async function appendStepToSession(sessionId: string, step: TuneStep): Promise<void> {
  const s = await idb.get<TuneSession>('sessions', sessionId);
  if (!s) throw new Error('session not found');
  s.steps.push(step);
  s.updatedAt = Date.now();
  await idb.put('sessions', s);
  await store.reloadSessions();
}

export async function createSession(customerName: string, bowId: string, arrowId: string): Promise<TuneSession> {
  const s: TuneSession = {
    id: uid('session'),
    customerName: customerName || '散客',
    bowId,
    arrowId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    steps: [],
  };
  await idb.put('sessions', s);
  await store.reloadSessions();
  store.selection.sessionId = s.id;
  store.persistSelection();
  return s;
}
