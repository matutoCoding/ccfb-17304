import type { PageInstance } from '../ui/page';
import { h, badge, toast } from '../ui/dom';
import { store } from '../state/store';
import type { TuneParams } from '../core/types';
import { computeArrowStats } from '../core/physics';
import {
  computeTear,
  detectContacts,
  makeShotConfig,
  paperTimeS,
  powerS,
  T_END_S,
} from '../core/shot';
import { adviseForShot } from '../core/diagnose';
import { drawPaperTear } from '../ui/tearDraw';
import { LaunchScene } from '../three/LaunchScene';
import { simulateGroup } from '../core/ballistics';
import { drawTargetFace } from '../ui/targetFace';
import { appendStepToSession, buildStep, createSession } from '../state/records';
import { fmt } from '../core/util';

export function createSimPage(): PageInstance {
  const root = h('div') as HTMLDivElement;
  let scene: LaunchScene | null = null;
  let raf = 0;
  let lastWall = 0;
  let playing = false;
  let t = 0;
  let seedSalt = 0;
  let view: 'hs' | 'range' = 'hs';
  let rangeDrawn = false;

  const bow = store.bow;
  const arrow = store.arrow;
  if (!bow || !arrow) {
    root.appendChild(h('div', { class: 'empty' }, '请先在弓箭档案中建立弓与箭'));
    return { el: root };
  }

  const params: TuneParams = {
    nockHeightMm: bow.nockHeightMm,
    restCenterMm: bow.restCenterMm,
    plungerPressure: bow.plungerPressure,
    pointWeightGr: arrow.pointWeightGr,
  };
  let chaos = 0.12;
  let distance = store.settings.paperDistanceM;
  let fps = store.settings.cameraFps;
  let exposureMs = store.settings.exposureMs;
  let slowMo = store.settings.slowMo || 1000;
  let showTrails = store.settings.showTrails;
  let showTopSide = store.settings.showTopSide;

  // refs
  let timeSlider!: HTMLInputElement;
  let timeLabel!: HTMLElement;
  let hudTimeLabel!: HTMLElement;
  let frameLabel!: HTMLElement;
  let hudSpeed!: HTMLElement;
  let hudF1!: HTMLElement;
  let hudPaper!: HTMLElement;
  let hudContact!: HTMLElement;
  let tearCanvas!: HTMLCanvasElement;
  let verdictHost!: HTMLElement;
  let adviceHost!: HTMLElement;
  let contactHost!: HTMLElement;
  let stageHost!: HTMLElement;
  let labelMain!: HTMLElement;
  let labelTop!: HTMLElement;
  let labelSide!: HTMLElement;
  let hsView!: HTMLElement;
  let rangeView!: HTMLElement;

  function currentCfg() {
    const stats = computeArrowStats(arrow!, bow!);
    return makeShotConfig(bow!, arrow!, stats, params, { chaos, paperDistanceM: distance, seed: 20261126 });
  }

  function init(): void {
    cleanupScene();
    root.replaceChildren();
    root.appendChild(header());

    const tabs = h('div', { class: 'tabs mb16' },
      h('button', { class: `tab ${view === 'hs' ? 'active' : ''}`, onClick: () => switchView('hs') }, '出箭瞬间 · 高速摄影'),
      h('button', { class: `tab ${view === 'range' ? 'active' : ''}`, onClick: () => switchView('range') }, '18 / 30m 远距落点'),
    );
    root.appendChild(tabs);

    hsView = h('div', { class: 'layout-sim' });
    hsView.appendChild(buildStageCol());
    hsView.appendChild(buildControlCol());
    root.appendChild(hsView);

    rangeView = h('div', { hidden: view !== 'range' });
    root.appendChild(rangeView);
    hsView.hidden = view !== 'hs';
    if (view === 'range') renderRange();

    // 创建 three 场景
    scene = new LaunchScene(stageHost, { main: labelMain, top: labelTop, side: labelSide });
    scene.showTrails = showTrails;
    scene.showTopSide = showTopSide;
    scene.setExposure(exposureMs);
    const cfg = currentCfg();
    scene.setConfig(cfg);
    scene.setTime(t);

    refreshDerived();
    startLoop();
  }

  function cleanupScene(): void {
    cancelAnimationFrame(raf);
    raf = 0;
    scene?.dispose();
    scene = null;
  }

  function switchView(v: 'hs' | 'range'): void {
    view = v;
    init();
  }

  function header(): HTMLElement {
    const bowSel = h('select', { class: 'select', style: 'min-width:210px' },
      ...store.bows.map((b) => h('option', { value: b.id, selected: b.id === bow!.id }, b.name))) as HTMLSelectElement;
    bowSel.addEventListener('change', () => { store.selection.bowId = bowSel.value; store.persistSelection(); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    const arrSel = h('select', { class: 'select', style: 'min-width:240px' },
      ...store.arrows.map((a) => h('option', { value: a.id, selected: a.id === arrow!.id }, a.name))) as HTMLSelectElement;
    arrSel.addEventListener('change', () => { store.selection.arrowId = arrSel.value; store.persistSelection(); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    return h('div', { class: 'topbar' },
      h('div', null, h('h1', { style: 'font-size:20px' }, '出箭推演'), h('div', { class: 'crumb-sub' }, '细长梁振型叠加 · 顶点着色器弯曲 · 方向与白纸调弓手册对齐')),
      h('span', { class: 'topbar-spacer' }),
      bowSel, arrSel);
  }

  function buildStageCol(): HTMLElement {
    const col = h('div');
    stageHost = h('div', { class: 'stage-wrap', style: 'height:560px' });
    labelMain = h('div', { class: 'view-label' }, '透视');
    labelTop = h('div', { class: 'view-label' }, '顶视');
    labelSide = h('div', { class: 'view-label' }, '侧视');
    const hud = h('div', { class: 'stage-hud' },
      hudTime(),
      hudChip('帧 ', frameLabel = h('b', null, '0')),
      hudChip('速度 ', hudSpeed = h('b', null, '—')),
      hudChip('f₁ ', hudF1 = h('b', null, '—')),
      hudChip('过纸 ', hudPaper = h('b', null, '—')),
      hudChip('擦羽 ', hudContact = h('b', null, '0')),
    );
    stageHost.append(labelMain, labelTop, labelSide, hud);
    col.appendChild(stageHost);

    // —— 时间轴 ——
    timeSlider = h('input', { type: 'range', min: '0', max: T_END_S.toFixed(4), step: String(1 / fps), value: '0' }) as HTMLInputElement;
    timeSlider.addEventListener('input', () => { t = +timeSlider.value; playing = false; updatePlayBtn(); scene?.setTime(t); updateTimeLabel(); });

    timeLabel = h('span', { class: 't-time' }, '0.00 ms');

    const playBtn = h('button', { class: 'btn btn-primary btn-sm' }, '▶ 播放') as HTMLButtonElement;
    const updatePlayBtn = () => { playBtn.textContent = playing ? '⏸ 暂停' : '▶ 播放'; };
    playBtn.addEventListener('click', () => { playing = !playing; lastWall = 0; updatePlayBtn(); });
    const stepFrame = (dir: number) => { t = Math.max(0, Math.min(T_END_S, t + dir / fps)); timeSlider.value = String(t); scene?.setTime(t); updateTimeLabel(); };
    const back = h('button', { class: 'icon-btn', title: '上一帧', onClick: () => stepFrame(-1) }, '⏮');
    const fwd = h('button', { class: 'icon-btn', title: '下一帧', onClick: () => stepFrame(1) }, '⏭');
    const reset = h('button', { class: 'btn btn-sm', onClick: () => { t = 0; timeSlider.value = '0'; scene?.setTime(0); updateTimeLabel(); } }, '归零');
    const toPaper = h('button', { class: 'btn btn-sm', onClick: () => { t = paperTimeS(currentCfg()); timeSlider.value = String(t); scene?.setTime(t); updateTimeLabel(); } }, '跳到穿纸');

    const fpsSel = h('select', { class: 'select btn-sm', style: 'width:auto;padding:5px 8px' },
      ...[240, 1000, 4000].map((f) => h('option', { value: String(f), selected: f === fps }, `${f} fps`))) as HTMLSelectElement;
    fpsSel.addEventListener('change', () => { fps = +fpsSel.value; timeSlider.step = String(1 / fps); });

    const slowSel = h('select', { class: 'select btn-sm', style: 'width:auto;padding:5px 8px' },
      ...[1, 10, 100, 1000].map((s) => h('option', { value: String(s), selected: s === slowMo }, `${s}× 慢放`))) as HTMLSelectElement;
    slowSel.addEventListener('change', () => { slowMo = +slowSel.value; });

    col.appendChild(h('div', { class: 'card mt12' },
      h('div', { class: 'timeline', style: 'padding-top:0' },
        timeLabel,
        timeSlider,
      ),
      h('div', { class: 'transport' },
        playBtn, back, fwd, reset, toPaper,
        h('span', { class: 'muted', style: 'font-size:12px' }, '逐帧'), fpsSel, slowSel,
      ),
      h('div', { class: 'flex-wrap flex mt12' },
        toggle('运动拖影(曝光)', showTrails, (v) => { showTrails = v; if (scene) scene.showTrails = v; }),
        toggle('顶/侧双机位', showTopSide, (v) => { showTopSide = v; if (scene) scene.showTopSide = v; }),
        h('div', { class: 'range-row grow', style: 'min-width:220px' },
          h('span', { class: 'field-label', style: 'white-space:nowrap' }, '曝光'),
          (() => { const r = h('input', { type: 'range', min: '0.1', max: '2', step: '0.1', value: String(exposureMs) }) as HTMLInputElement; const v = h('span', { class: 'range-val' }, `${exposureMs.toFixed(1)}ms`); r.addEventListener('input', () => { exposureMs = +r.value; v.textContent = `${exposureMs.toFixed(1)}ms`; scene?.setExposure(exposureMs); }); return [r, v]; })(),
        ),
      ),
    ));
    return col;
  }

  function hudTime(): HTMLElement {
    hudTimeLabel = h('b', null, '0.00 ms');
    return h('span', { class: 'hud-chip' }, 't ', hudTimeLabel);
  }

  function hudChip(label: string, valueEl: HTMLElement): HTMLElement {
    return h('span', { class: 'hud-chip' }, label, valueEl);
  }

  function buildControlCol(): HTMLElement {
    const side = h('div', { class: 'side-panel' });

    // 调校滑杆
    const tune = h('div', { class: 'card' });
    tune.appendChild(h('div', { class: 'card-h' }, h('h3', null, '调校参数（what-if）')));
    tune.appendChild(slider('搭箭点高度 mm', -4, 12, 0.1, params.nockHeightMm, (v) => params.nockHeightMm = v, ' mm'));
    tune.appendChild(slider('箭台中心距 mm', -4, 4, 0.1, params.restCenterMm, (v) => params.restCenterMm = v, ' mm'));
    tune.appendChild(slider('弹性柱压力', 0, 100, 1, params.plungerPressure, (v) => params.plungerPressure = v, ' 格'));
    tune.appendChild(slider('箭头重量 gr', 60, 200, 5, params.pointWeightGr, (v) => params.pointWeightGr = v, ' gr'));
    tune.appendChild(slider('新手散乱度', 0, 1, 0.02, chaos, (v) => chaos = v, ''));
    tune.appendChild(slider('纸靶射距 m', 1, 5, 0.1, distance, (v) => distance = v, ' m'));
    tune.appendChild(h('button', {
      class: 'btn btn-cyan mt12', style: 'width:100%',
      onClick: () => recordCurrent(),
    }, '● 把当前状态记为调试一步'));
    side.appendChild(tune);

    // 纸靶裂口
    const tearCard = h('div', { class: 'card' });
    tearCard.appendChild(h('div', { class: 'card-h' }, h('h3', null, '程序纸靶裂口'), h('span', { class: 'spacer' }), verdictHost = h('span')));
    tearCanvas = document.createElement('canvas');
    tearCanvas.width = 360;
    tearCanvas.height = 300;
    tearCanvas.style.width = '100%';
    const wrap = h('div', { class: 'tear-canvas-wrap' }, tearCanvas);
    tearCard.appendChild(wrap);
    side.appendChild(tearCard);

    // 建议
    const advCard = h('div', { class: 'card' });
    advCard.appendChild(h('div', { class: 'card-h' }, h('h3', null, '调弓建议（改动量排序）')));
    adviceHost = h('div');
    advCard.appendChild(adviceHost);
    side.appendChild(advCard);

    // 擦羽
    const contactCard = h('div', { class: 'card' });
    contactCard.appendChild(h('div', { class: 'card-h' }, h('h3', null, '箭羽 / 箭台 / 弓窗接触检测')));
    contactHost = h('div');
    contactCard.appendChild(contactHost);
    side.appendChild(contactCard);

    return side;
  }

  function slider(label: string, min: number, max: number, step: number, value: number, set: (v: number) => void, unit: string): HTMLElement {
    const val = h('span', { class: 'range-val' }, `${value}${unit}`);
    const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) }) as HTMLInputElement;
    input.addEventListener('input', () => {
      const v = +input.value;
      set(v);
      val.textContent = `${step < 1 ? v.toFixed(1) : Math.round(v)}${unit}`;
      refreshDerived();
    });
    return h('div', { class: 'field mt8' }, h('span', { class: 'field-label' }, label), h('div', { class: 'range-row' }, input, val));
  }

  function toggle(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
    const cb = h('input', { type: 'checkbox', ...(checked ? { checked: true } : {}) }) as HTMLInputElement;
    cb.checked = checked;
    cb.addEventListener('change', () => onChange(cb.checked));
    return h('label', { class: 'flex', style: 'gap:8px;font-size:12.5px;color:var(--text-2);cursor:pointer' }, h('span', { class: 'switch' }, cb, h('span', { class: 'track' })), label);
  }

  function refreshDerived(): void {
    if (!bow || !arrow) return;
    const stats = computeArrowStats(arrow, bow);
    const cfg = currentCfg();
    scene?.setConfig(cfg);
    const tear = computeTear(cfg);
    const advices = adviseForShot(cfg, tear, params);
    const contacts = detectContacts(cfg);

    hudF1.textContent = `${cfg.f1Hz.toFixed(1)}Hz`;
    hudPaper.textContent = `${(paperTimeS(cfg) * 1000).toFixed(1)}ms`;
    hudContact.textContent = String(contacts.length);

    // 裂口
    const ctx = tearCanvas.getContext('2d')!;
    ctx.fillStyle = '#f2eddd';
    ctx.fillRect(0, 0, tearCanvas.width, tearCanvas.height);
    drawPaperTear(ctx, tear, tearCanvas.width / 2, tearCanvas.height / 2, 2.1);

    verdictHost.replaceChildren(
      badge(tear.vertical === 'high' ? '口子上翘' : tear.vertical === 'low' ? '下扎' : '垂直正', tear.vertical === 'high' ? 'warn' : tear.vertical === 'low' ? 'info' : 'good'),
      badge(tear.horizontal === 'soft' ? '偏软侧横撕' : tear.horizontal === 'stiff' ? '偏硬侧横撕' : '水平正', tear.horizontal === 'soft' ? 'soft' : tear.horizontal === 'stiff' ? 'stiff' : 'good'),
    );

    // 建议
    adviceHost.replaceChildren(...advices.slice(0, 5).map((a, i) => {
      return h('div', { class: `advice-item prio-${Math.min(3, i)}` },
        h('div', { class: 'advice-top' }, h('span', { class: 't' }, a.title), h('span', { class: 'advice-delta' }, a.deltaText)),
        h('div', { class: 'advice-dir' }, a.direction),
        h('div', { class: 'advice-reason' }, a.reason),
        h('div', { class: 'advice-meta' },
          h('span', { class: 'sort-index' }, `改动量 ${a.changeAmount.toFixed(1)} · 置信 ${(a.confidence * 100).toFixed(0)}%`),
          h('span', { class: 'spacer grow' }),
          a.patch ? h('button', {
            class: 'btn btn-sm',
            onClick: () => {
              if (a.patch) Object.assign(params, a.patch);
              init();
            },
          }, '应用') : null,
          h('button', {
            class: 'btn btn-primary btn-sm',
            onClick: async () => {
              const before = { ...params };
              if (a.patch) Object.assign(params, a.patch);
              await recordCurrent(a.title, before);
              init();
            },
          }, '应用并记一步')));
    }));

    // 接触
    if (!contacts.length) {
      contactHost.replaceChildren(h('p', { class: 'muted', style: 'font-size:12.5px' }, '未检出箭羽擦碰箭台/弓窗，间隙正常。'));
    } else {
      const targetName = { rest_blade: '箭台刀片', riser_window: '弓窗侧壁', plunger: '弹性柱' } as const;
      contactHost.replaceChildren(...contacts.map((c) =>
        h('div', { class: 'stat-line' },
          h('span', { class: 'k' }, `第 ${c.vaneIndex + 1} 片羽 · ${targetName[c.target]}`),
          h('span', { class: 'v', style: 'color:var(--red)' }, `${(c.tS * 1000).toFixed(1)}ms · ${c.severityMm.toFixed(1)}mm`))));
    }
    void stats;
  }

  function updateTimeLabel(): void {
    const txt = `${(t * 1000).toFixed(2)} ms`;
    if (timeLabel) timeLabel.textContent = txt;
    if (hudTimeLabel) hudTimeLabel.textContent = txt;
    if (frameLabel) frameLabel.textContent = String(Math.round(t * fps));
    if (hudSpeed) {
      const cfg = currentCfg();
      const speed = t < powerS(cfg) ? cfg.v0Mps * Math.max(0, t / powerS(cfg)) : cfg.v0Mps;
      hudSpeed.textContent = `${speed.toFixed(1)}m/s`;
    }
  }

  function startLoop(): void {
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!lastWall) lastWall = now;
      const dt = Math.min(0.05, (now - lastWall) / 1000);
      lastWall = now;
      if (playing) {
        t += dt / slowMo;
        if (t > T_END_S) t = 0;
        if (timeSlider) timeSlider.value = String(t);
      }
      scene?.setTime(t);
      updateTimeLabel();
    };
    raf = requestAnimationFrame(loop);
  }

  async function recordCurrent(title?: string, before?: TuneParams): Promise<void> {
    if (!bow || !arrow) return;
    let session = store.session;
    if (!session) session = await createSession('散客', bow.id, arrow.id);
    const step = buildStep({
      bow, arrow, params: { ...params }, chaos,
      title: title ?? `手动调校 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`,
      prevParams: before ?? session.steps[session.steps.length - 1]?.params,
    });
    await appendStepToSession(session.id, step);
    toast(`已记入「${session.customerName}」调试过程（第 ${session.steps.length + 1} 步）`);
  }

  function renderRange(): void {
    rangeView.replaceChildren();
    const cfg = currentCfg();
    const bar = h('div', { class: 'card-h' },
      h('h3', null, '18m / 30m 裸杆 vs 带羽弹着'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-primary btn-sm', onClick: () => { seedSalt++; renderRange(); } }, '↻ 重新射一组'));
    rangeView.appendChild(h('div', { class: 'card mb16' }, bar));
    const grid = h('div', { class: 'grid cols-2' });
    for (const d of [18, 30] as const) {
      const bare = simulateGroup(cfg, d, 'bare', 6, seedSalt);
      const fl = simulateGroup(cfg, d, 'fletched', 6, seedSalt);
      const cv = document.createElement('canvas');
      cv.className = 'target-face';
      const card = h('div', { class: 'card' },
        h('h3', { class: 'center mb8' }, `${d} m`),
        cv,
        h('div', { class: 'legend' },
          h('span', null, h('span', { class: 'dot', style: 'background:#ff5d5d' }), `裸杆 组径 ${fmt(bare.groupSizeMm, 0)}mm`),
          h('span', null, h('span', { class: 'dot', style: 'background:#19c7e6' }), `带羽 组径 ${fmt(fl.groupSizeMm, 0)}mm`)),
        h('div', { class: 'kv-grid mt12', style: 'grid-template-columns:1fr 1fr' },
          kvMini('裸杆组心', `${bare.centerHMm.toFixed(0)}, ${bare.centerVMm.toFixed(0)}`, 'mm (h,v)'),
          kvMini('带羽组心', `${fl.centerHMm.toFixed(0)}, ${fl.centerVMm.toFixed(0)}`, 'mm (h,v)'),
          kvMini('裸杆平均R', fmt(bare.meanRadiusMm, 0), 'mm'),
          kvMini('带羽平均R', fmt(fl.meanRadiusMm, 0), 'mm'),
        ),
      );
      grid.appendChild(card);
      requestAnimationFrame(() => drawTargetFace(cv, [bare, fl]));
    }
    rangeView.appendChild(grid);
    rangeDrawn = true;
  }

  init();
  return {
    el: root,
    destroy() {
      cleanupScene();
    },
  };
}

function kvMini(k: string, v: string, unit: string): HTMLElement {
  return h('div', { class: 'kv' }, h('div', { class: 'k' }, k), h('div', { class: 'v', style: 'font-size:15px' }, v, h('small', null, unit)));
}
