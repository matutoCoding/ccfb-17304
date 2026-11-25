import type { PageInstance } from '../ui/page';
import { h, badge, toast } from '../ui/dom';
import { store } from '../state/store';
import type { PhotoRecord, TuneParams, TuneStep } from '../core/types';
import { idb } from '../db/database';
import { marksToVectorMm, adviseFromTear } from '../core/diagnose';
import { tearFromMeasuredVector, makeShotConfig, computeTear } from '../core/shot';
import { computeArrowStats } from '../core/physics';
import { drawPaperTear } from '../ui/tearDraw';
import { appendStepToSession, createSession } from '../state/records';
import { uid } from '../core/util';

type MarkMode = 'point' | 'tear';

export function createDiagnosePage(): PageInstance {
  const root = h('div') as HTMLDivElement;
  let photo: PhotoRecord | undefined = store.photos[0];
  let marks = photo?.groundTruth
    ? structuredClone(photo.groundTruth)
    : { pointPx: null, tearPx: null, extraTearsPx: [], shooterView: true, paperWidthMm: 600, imageWidthPx: photo?.width ?? 1000 };
  let mode: MarkMode = 'point';
  const bow = store.bow;
  const arrow = store.arrow;
  const params: TuneParams = bow
    ? { nockHeightMm: bow.nockHeightMm, restCenterMm: bow.restCenterMm, plungerPressure: bow.plungerPressure, pointWeightGr: arrow?.pointWeightGr ?? 100 }
    : { nockHeightMm: 3, restCenterMm: 0, plungerPressure: 50, pointWeightGr: 100 };

  let markCanvas: HTMLCanvasElement;
  let simCanvas: HTMLCanvasElement;
  let resultHost: HTMLElement;
  let adviceHost: HTMLElement;
  let marksInfo: HTMLElement;

  function render(): void {
    root.replaceChildren();
    root.appendChild(
      h('div', { class: 'section-title' },
        h('div', null, h('h2', null, '纸靶诊断'), h('p', null, '导入客户实射照片，点出箭头孔与箭羽撕痕，反算偏差方向，和系统推演的程序裂口并排比较。')),
        h('div', { class: 'flex' }, uploadBtn(), h('button', { class: 'btn', onClick: () => window.open('#/sim', '_self') }, '去出箭推演 →'))),
    );

    const layout = h('div', { class: 'layout-diag' });

    // —— 左：照片 + 标注 ——
    const left = h('div', { class: 'card' });
    const modePoint = h('button', { class: `btn btn-sm ${mode === 'point' ? 'active' : ''}`, onClick: () => { mode = 'point'; syncMode(); } }, '① 标箭头孔');
    const modeTear = h('button', { class: `btn btn-sm ${mode === 'tear' ? 'active' : ''}`, onClick: () => { mode = 'tear'; syncMode(); } }, '② 标箭羽撕痕');
    const fillGt = h('button', { class: 'btn btn-sm btn-cyan', onClick: () => { if (photo?.groundTruth) { marks = structuredClone(photo.groundTruth); marks.imageWidthPx = photo.width; drawMarks(); recompute(); toast('已填入合成样片的预置标注'); } } }, '填入样片标注');
    const clearMarks = h('button', { class: 'btn btn-sm', onClick: () => { marks.pointPx = null; marks.tearPx = null; drawMarks(); recompute(); } }, '清除标注');
    left.appendChild(h('div', { class: 'card-h' }, h('h3', null, photo?.name ?? '实射照片'), h('span', { class: 'spacer' }), modePoint, modeTear, fillGt, clearMarks));

    const stage = h('div', { class: 'photo-stage' });
    if (photo) {
      const img = h('img', { src: photo.dataUrl, alt: photo.name }) as HTMLImageElement;
      markCanvas = h('canvas', { class: 'mark-layer' }) as HTMLCanvasElement;
      markCanvas.width = photo.width;
      markCanvas.height = photo.height;
      markCanvas.addEventListener('click', onCanvasClick);
      stage.append(img, markCanvas);
    } else {
      stage.appendChild(h('div', { class: 'empty' }, h('div', { class: 'big' }, '📷'), '还没有照片，点右上角导入或选择下方合成样片'));
    }
    left.appendChild(stage);

    // 缩略图
    const thumbs = h('div', { class: 'photo-thumbs' });
    for (const p of store.photos) {
      const t = h('div', { class: `photo-thumb ${photo?.id === p.id ? 'active' : ''}`, onClick: () => { photo = p; marks = p.groundTruth ? structuredClone(p.groundTruth) : { pointPx: null, tearPx: null, extraTearsPx: [], shooterView: true, paperWidthMm: 600, imageWidthPx: p.width }; render(); } },
        h('img', { src: p.dataUrl }),
        h('span', { class: 'tag' }, p.tags?.[0] ?? (p.kind === 'import' ? '导入' : '样片')));
      thumbs.appendChild(t);
    }
    left.appendChild(thumbs);

    // 标定行
    const paperW = h('input', { class: 'input', type: 'number', value: String(marks.paperWidthMm), style: 'width:110px' }) as HTMLInputElement;
    paperW.addEventListener('change', () => { marks.paperWidthMm = +paperW.value; recompute(); });
    const viewChk = h('input', { type: 'checkbox' }) as HTMLInputElement;
    viewChk.checked = marks.shooterView;
    viewChk.addEventListener('change', () => { marks.shooterView = viewChk.checked; recompute(); });
    left.appendChild(h('div', { class: 'flex-wrap flex mt12' },
      h('label', { class: 'flex', style: 'gap:7px;font-size:12.5px;color:var(--text-2)' }, viewChk, '射手侧视角（否则水平镜像）'),
      h('span', { class: 'spacer grow' }),
      h('span', { class: 'field-label' }, '纸宽 mm'), paperW,
    ));
    marksInfo = h('p', { class: 'muted mt8', style: 'font-size:12px' }, '先点箭头孔，再点箭羽撕痕端点。');
    left.appendChild(marksInfo);
    layout.appendChild(left);

    // —— 右：反算 + 并排推演 + 建议 ——
    const right = h('div', { class: 'side-panel' });
    resultHost = h('div', { class: 'card' });
    right.appendChild(resultHost);

    const compareCard = h('div', { class: 'card' });
    compareCard.appendChild(h('div', { class: 'card-h' }, h('h3', null, '系统推演裂口（并排对照）'), h('span', { class: 'spacer' }), bow ? badge(bow.handedness === 'RH' ? '右手弓 · 软侧在左' : '左手弓 · 软侧在右', 'info') : null));
    simCanvas = document.createElement('canvas');
    simCanvas.width = 360;
    simCanvas.height = 300;
    simCanvas.style.width = '100%';
    compareCard.appendChild(h('div', { class: 'tear-canvas-wrap' }, simCanvas));
    right.appendChild(compareCard);

    adviceHost = h('div');
    right.appendChild(adviceHost);

    layout.appendChild(right);
    root.appendChild(layout);

    requestAnimationFrame(() => { drawMarks(); recompute(); });
  }

  function syncMode(): void {
    document.querySelectorAll('.card-h .btn').forEach(() => {});
    render();
  }

  function onCanvasClick(e: MouseEvent): void {
    if (!markCanvas || !photo) return;
    const rect = markCanvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * markCanvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * markCanvas.height;
    if (mode === 'point') {
      marks.pointPx = { x, y };
      mode = 'tear';
      toast('已标箭头孔，请点箭羽撕痕端点', 'ok', 1600);
    } else {
      marks.tearPx = { x, y };
    }
    drawMarks();
    recompute();
    // 更新模式按钮高亮（轻量：重渲染按钮区最简单，但会重建 canvas；改为直接改文字）
  }

  function drawMarks(): void {
    if (!markCanvas || !photo) return;
    const ctx = markCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, markCanvas.width, markCanvas.height);
    const P = marks.pointPx;
    const T = marks.tearPx;
    if (P) {
      ctx.beginPath();
      ctx.arc(P.x, P.y, 16, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff4d4d';
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(P.x, P.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ff4d4d';
      ctx.fill();
    }
    if (T) {
      ctx.beginPath();
      ctx.arc(T.x, T.y, 13, 0, Math.PI * 2);
      ctx.strokeStyle = '#35e0ff';
      ctx.lineWidth = 5;
      ctx.stroke();
    }
    if (P && T) {
      ctx.beginPath();
      ctx.moveTo(P.x, P.y);
      ctx.lineTo(T.x, T.y);
      ctx.strokeStyle = 'rgba(255,209,102,0.95)';
      ctx.lineWidth = 6;
      ctx.setLineDash([14, 10]);
      ctx.stroke();
      ctx.setLineDash([]);
      // 箭头
      const a = Math.atan2(T.y - P.y, T.x - P.x);
      ctx.beginPath();
      ctx.moveTo(T.x, T.y);
      ctx.lineTo(T.x - 26 * Math.cos(a - 0.4), T.y - 26 * Math.sin(a - 0.4));
      ctx.lineTo(T.x - 26 * Math.cos(a + 0.4), T.y - 26 * Math.sin(a + 0.4));
      ctx.closePath();
      ctx.fillStyle = '#ffd166';
      ctx.fill();
    }
  }

  function recompute(): void {
    if (!resultHost || !adviceHost) return;
    const vec = marksToVectorMm(marks);
    resultHost.replaceChildren();
    adviceHost.replaceChildren();

    // 推演裂口
    let simTear = null as null | ReturnType<typeof computeTear>;
    if (bow && arrow) {
      const stats = computeArrowStats(arrow, bow);
      const cfg = makeShotConfig(bow, arrow, stats, params);
      simTear = computeTear(cfg);
      const ctx = simCanvas.getContext('2d')!;
      ctx.fillStyle = '#f2eddd';
      ctx.fillRect(0, 0, simCanvas.width, simCanvas.height);
      drawPaperTear(ctx, simTear, simCanvas.width / 2, simCanvas.height / 2, 2.1);
    }

    if (!vec) {
      resultHost.append(h('div', { class: 'card-h' }, h('h3', null, '反算偏差')), h('p', { class: 'muted' }, '尚未完成两个标注。'));
      marksInfo.textContent = '先点箭头孔，再点箭羽撕痕端点。';
      return;
    }
    const measured = tearFromMeasuredVector(vec.dHMm, vec.dVMm, bow?.handedness ?? 'RH', 777, 0.25);
    const advices = adviseFromTear(measured, { bowType: bow?.bowType, handedness: bow?.handedness ?? 'RH', params, chaos: 0.25 });
    marksInfo.textContent = `像素向量 → 水平 ${vec.dHMm.toFixed(1)}mm，垂直 ${vec.dVMm.toFixed(1)}mm；主撕痕 ${measured.angleDeg.toFixed(0)}°。`;

    resultHost.appendChild(h('div', { class: 'card-h' },
      h('h3', null, '反算偏差方向'), h('span', { class: 'spacer' }),
      badge(measured.vertical === 'high' ? '口子上翘 · 搭箭点低' : measured.vertical === 'low' ? '下扎 · 搭箭点高' : '垂直基本正', measured.vertical === 'high' ? 'warn' : measured.vertical === 'low' ? 'info' : 'good'),
      badge(measured.horizontal === 'soft' ? '偏软侧横撕' : measured.horizontal === 'stiff' ? '偏硬侧横撕' : '水平基本正', measured.horizontal === 'soft' ? 'soft' : measured.horizontal === 'stiff' ? 'stiff' : 'good')));
    resultHost.appendChild(h('div', { class: 'kv-grid', style: 'grid-template-columns:repeat(3,1fr)' },
      kvD('水平', vec.dHMm.toFixed(1), 'mm'),
      kvD('垂直', vec.dVMm.toFixed(1), 'mm'),
      kvD('撕痕长', measured.lengthMm.toFixed(0), 'mm')));

    // 建议 + 记步
    adviceHost.appendChild(h('div', { class: 'card' },
      h('div', { class: 'card-h' }, h('h3', null, '调弓建议（改动量从小到大）'))));
    const card = adviceHost.firstElementChild as HTMLElement;
    for (const [i, a] of advices.entries()) {
      card.appendChild(h('div', { class: `advice-item prio-${Math.min(3, i)}` },
        h('div', { class: 'advice-top' }, h('span', { class: 't' }, a.title), h('span', { class: 'advice-delta' }, a.deltaText)),
        h('div', { class: 'advice-dir' }, a.direction),
        h('div', { class: 'advice-reason' }, a.reason),
        h('div', { class: 'advice-meta' },
          h('span', { class: 'sort-index' }, `改动量 ${a.changeAmount.toFixed(1)}`),
          h('span', { class: 'spacer grow' }),
          h('button', { class: 'btn btn-sm', onClick: () => { if (a.patch) Object.assign(params, a.patch); recompute(); toast('已应用到右侧推演参数'); } }, '应用到推演'),
          h('button', { class: 'btn btn-primary btn-sm', onClick: () => recordDiagnosisStep(a.patch ? { ...params, ...a.patch } : { ...params }, measured, advices, photo?.id) }, '记一步'))));
    }
    if (bow && arrow) {
      card.appendChild(h('button', { class: 'btn btn-cyan mt12', style: 'width:100%', onClick: () => recordDiagnosisStep({ ...params }, measured, advices, photo?.id) }, '把当前诊断（含照片）记为调试一步'));
    }
  }

  async function recordDiagnosisStep(p: TuneParams, measured: ReturnType<typeof tearFromMeasuredVector>, advices: ReturnType<typeof adviseFromTear>, photoId?: string): Promise<void> {
    if (!bow || !arrow) { toast('请先在档案中选择弓和箭', 'warn'); return; }
    let session = store.session;
    if (!session) session = await createSession('散客', bow.id, arrow.id);
    const step: TuneStep = {
      id: uid('step'),
      at: Date.now(),
      title: `照片诊断 · ${photo?.tags?.join('/') ?? '实射'}`,
      note: `水平 ${measured.tailHMm.toFixed(1)}mm / 垂直 ${measured.tailVMm.toFixed(1)}mm；${measured.vertical}/${measured.horizontal}`,
      params: p,
      arrowId: arrow.id,
      tear: measured,
      contactCount: 0,
      advices,
      photoId,
      changes: session.steps.length ? [`按诊断调整（${advices[0]?.title ?? '保持'}）`] : [],
    };
    await appendStepToSession(session.id, step);
    toast(`已记入「${session.customerName}」，可到调试记录回放`);
  }

  function uploadBtn(): HTMLElement {
    const inp = h('input', { type: 'file', accept: 'image/*', style: 'display:none' }) as HTMLInputElement;
    inp.addEventListener('change', async () => {
      const file = inp.files?.[0];
      if (!file) return;
      const dataUrl = await new Promise<string>((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result as string);
        fr.onerror = rej;
        fr.readAsDataURL(file);
      });
      const dims = await new Promise<{ w: number; h: number }>((res) => {
        const im = new Image();
        im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
        im.src = dataUrl;
      });
      const rec: PhotoRecord = {
        id: uid('photo'), name: `导入照片 · ${file.name.slice(0, 18)}`, kind: 'import', createdAt: Date.now(),
        dataUrl, width: dims.w, height: dims.h, tags: ['导入'],
      };
      await idb.put('photos', rec);
      await store.reloadPhotos();
      photo = rec;
      marks = { pointPx: null, tearPx: null, extraTearsPx: [], shooterView: true, paperWidthMm: 600, imageWidthPx: dims.w };
      toast('照片已导入 IndexedDB');
      render();
    });
    return h('label', null, h('button', { class: 'btn btn-primary', onClick: () => inp.click() }, '📤 导入实射照片'), inp);
  }

  render();
  return { el: root };
}

function kvD(k: string, v: string, unit: string): HTMLElement {
  return h('div', { class: 'kv' }, h('div', { class: 'k' }, k), h('div', { class: 'v', style: 'font-size:17px' }, v, h('small', null, unit)));
}
