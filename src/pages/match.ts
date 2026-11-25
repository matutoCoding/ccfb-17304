import type { PageInstance } from '../ui/page';
import { h, badge } from '../ui/dom';
import { store } from '../state/store';
import type { ArrowProfile } from '../core/types';
import { computeArrowStats } from '../core/physics';
import { computeTear, makeShotConfig } from '../core/shot';
import { fmt } from '../core/util';
import { drawPaperTear } from '../ui/tearDraw';

export function createMatchPage(): PageInstance {
  const root = h('div') as HTMLDivElement;

  function render(): void {
    root.replaceChildren();
    const bow = store.bow;
    const arrow = store.arrow;
    root.appendChild(
      h('div', { class: 'section-title' },
        h('div', null, h('h2', null, '配箭计算'), h('p', null, '静态 spine 反推 EI，结合总重算梁一阶频率与动态 spine，再和弓的磅数/拉距需求对照。')),
        h('div', { class: 'flex' }, bowSelect(), arrowSelect()),
      ),
    );
    if (!bow || !arrow) {
      root.appendChild(h('div', { class: 'empty' }, '请先在弓箭档案中建立弓与箭'));
      return;
    }

    const stats = computeArrowStats(arrow, bow);

    // —— 核心指标 ——
    const verdictTone = stats.verdict === 'soft' ? 'bad' : stats.verdict === 'stiff' ? 'info' : 'good';
    const verdictText = stats.verdict === 'soft' ? '偏软 /  underspined' : stats.verdict === 'stiff' ? '偏硬 / overspined' : '匹配';
    root.appendChild(h('div', { class: 'kv-grid' },
      kv('总重', fmt(stats.totalWeightGr, 1), 'gr'),
      kv('FOC 前重比', fmt(stats.focPct, 1), '%', stats.focPct >= 7 && stats.focPct <= 18 ? 'good' : 'accent'),
      kv('动态 spine', fmt(stats.dynamicSpine, 0), '', stats.verdict === 'soft' ? 'bad' : stats.verdict === 'stiff' ? 'info' : 'good'),
      kv('配弓判定', verdictText, '', verdictTone),
    ));

    const grid = h('div', { class: 'grid cols-2 mt16' });

    // —— 左：详解 + 箭头 what-if ——
    const left = h('div', { class: 'card' });
    left.appendChild(h('div', { class: 'card-h' }, h('h3', null, '配重与硬度推演'), h('span', { class: 'spacer' }), badge(`软硬比 ${fmt(stats.spineRatio, 3)}`, verdictTone)));
    left.appendChild(h('div', { class: 'stat-line' }, h('span', { class: 'k' }, '箭杆重量（GPI×长度）'), h('span', { class: 'v' }, `${fmt(stats.shaftWeightGr, 1)} gr`)));
    left.appendChild(h('div', { class: 'stat-line' }, h('span', { class: 'k' }, '箭羽总重'), h('span', { class: 'v' }, `${fmt(stats.fletchWeightGr, 1)} gr`)));
    left.appendChild(h('div', { class: 'stat-line' }, h('span', { class: 'k' }, '重心位置（距箭尾）'), h('span', { class: 'v' }, `${fmt(stats.balancePointIn, 2)} in`)));
    left.appendChild(h('div', { class: 'stat-line' }, h('span', { class: 'k' }, '抗弯刚度 EI'), h('span', { class: 'v' }, `${fmt(stats.eiNm2, 2)} N·m²`)));
    left.appendChild(h('div', { class: 'stat-line' }, h('span', { class: 'k' }, '梁一阶频率 f₁'), h('span', { class: 'v' }, `${fmt(stats.beamF1Hz, 1)} Hz`)));
    left.appendChild(h('div', { class: 'stat-line' }, h('span', { class: 'k' }, '梁二阶频率 f₂'), h('span', { class: 'v' }, `${fmt(stats.beamF2Hz, 1)} Hz`)));
    left.appendChild(h('div', { class: 'stat-line' }, h('span', { class: 'k' }, '本弓推荐 spine'), h('span', { class: 'v' }, fmt(stats.bowRequiredSpine, 0))));

    // what-if 箭头重量
    const sliderVal = h('span', { class: 'range-val' }, `${arrow.pointWeightGr} gr`);
    const ratioLine = h('div', { class: 'mt12' });
    const tearCompare = h('div', { class: 'grid cols-2 mt12' });
    const slider = h('input', { type: 'range', min: '60', max: '200', step: '5', value: String(arrow.pointWeightGr) }) as HTMLInputElement;
    slider.addEventListener('input', () => {
      const gr = +slider.value;
      sliderVal.textContent = `${gr} gr`;
      const clone: ArrowProfile = { ...arrow, pointWeightGr: gr };
      const s2 = computeArrowStats(clone, bow);
      ratioLine.replaceChildren(
        h('div', { class: 'stat-line' }, h('span', { class: 'k' }, 'what-if 总重'), h('span', { class: 'v' }, `${fmt(s2.totalWeightGr, 1)} gr`)),
        h('div', { class: 'stat-line' }, h('span', { class: 'k' }, 'what-if FOC'), h('span', { class: 'v' }, `${fmt(s2.focPct, 1)} %`)),
        h('div', { class: 'stat-line' }, h('span', { class: 'k' }, 'what-if 动态 spine'), h('span', { class: 'v' }, fmt(s2.dynamicSpine, 0))),
        h('div', { class: 'stat-line' }, h('span', { class: 'k' }, 'what-if 软硬比'), h('span', { class: `v ${s2.verdict === 'soft' ? 'bad' : s2.verdict === 'stiff' ? '' : 'good'}` }, `${fmt(s2.spineRatio, 3)} ${s2.verdict === 'soft' ? '偏软' : s2.verdict === 'stiff' ? '偏硬' : '匹配'}`)),
        softnessBar(s2.spineRatio),
      );
      drawCompare(tearCompare, gr);
    });
    left.appendChild(h('div', { class: 'field mt16' },
      h('span', { class: 'field-label' }, '箭头重量 what-if（不改档案，仅推演）'),
      h('div', { class: 'range-row' }, slider, sliderVal)));
    left.appendChild(ratioLine);
    ratioLine.appendChild(softnessBar(stats.spineRatio));
    left.appendChild(h('div', { class: 'field-label mt16' }, '纸靶撕痕方向对照'));
    left.appendChild(tearCompare);
    drawCompare(tearCompare, arrow.pointWeightGr);
    grid.appendChild(left);

    // —— 右：全箭适配表 + 100/125 不变量 ——
    const right = h('div', { class: 'side-panel' });
    const proof = h('div', { class: 'card' });
    proof.appendChild(h('div', { class: 'card-h' }, h('h3', null, '关键方向自检 · 100 → 125gr'), h('span', { class: 'spacer' }), badge('单调朝偏软侧', 'good')));
    proof.appendChild(proof100125(bow.id, arrow.id));
    right.appendChild(proof);

    const tableCard = h('div', { class: 'card flush' });
    tableCard.appendChild(h('div', { style: 'padding:14px 16px 4px' }, h('h3', null, '本弓 × 全部箭档案适配')));
    const tableWrap = h('div', { style: 'overflow-x:auto;padding:6px 8px 12px' });
    const table = h('table', { class: 'data' },
      h('thead', null, h('tr', null, h('th', null, '箭型号'), h('th', null, 'spine'), h('th', null, '总重 gr'), h('th', null, 'FOC'), h('th', null, '软硬比'), h('th', null, '判定'))),
      h('tbody', null, ...store.arrows.map((a) => {
        const s = computeArrowStats(a, bow);
        const tone = s.verdict === 'soft' ? 'bad' : s.verdict === 'stiff' ? 'info' : 'good';
        const txt = s.verdict === 'soft' ? '偏软' : s.verdict === 'stiff' ? '偏硬' : '匹配';
        return h('tr', { style: 'cursor:pointer', onClick: () => { store.selection.arrowId = a.id; store.persistSelection(); render(); } },
          h('td', null, a.name),
          h('td', { class: 'mono' }, String(a.staticSpine)),
          h('td', { class: 'mono' }, fmt(s.totalWeightGr, 0)),
          h('td', { class: 'mono' }, fmt(s.focPct, 1)),
          h('td', { class: 'mono' }, fmt(s.spineRatio, 2)),
          h('td', null, badge(txt, tone)));
      })));
    tableWrap.appendChild(table);
    tableCard.appendChild(tableWrap);
    right.appendChild(tableCard);

    grid.appendChild(right);
    root.appendChild(grid);
  }

  function drawCompare(host: HTMLElement, currentGr: number): void {
    host.replaceChildren();
    const bow = store.bow!;
    const arrow = store.arrow!;
    const stats = computeArrowStats(arrow, bow);
    for (const gr of [100, 125] as const) {
      const cfg = makeShotConfig(bow, arrow, stats, { pointWeightGr: gr }, { seed: 88 });
      const tear = computeTear(cfg);
      const cv = document.createElement('canvas');
      cv.width = 300;
      cv.height = 240;
      const ctx = cv.getContext('2d')!;
      ctx.fillStyle = '#f2eddd';
      ctx.fillRect(0, 0, 300, 240);
      drawPaperTear(ctx, tear, 150, 120, 1.5);
      const active = currentGr === gr;
      const box = h('div', null,
        h('div', { class: 'tear-canvas-wrap', style: active ? 'outline:2px solid var(--amber);outline-offset:2px' : 'opacity:.9' }, cv),
        h('div', { class: 'center', style: 'padding:7px;font-weight:700;font-size:12.5px;background:#e7e0cb;color:#3a2f1c;border-radius:0 0 12px 12px;margin-top:-2px' },
          `${gr}gr · `,
          badge(tear.horizontal === 'soft' ? '偏软侧' : tear.horizontal === 'stiff' ? '偏硬侧' : '居中', tear.horizontal === 'soft' ? 'soft' : tear.horizontal === 'stiff' ? 'stiff' : 'good')));
      host.appendChild(box);
    }
  }

  render();
  return { el: root };
}

function bowSelect(): HTMLElement {
  const sel = h('select', { class: 'select', style: 'min-width:230px' },
    ...store.bows.map((b) => h('option', { value: b.id, selected: store.bow?.id === b.id }, b.name))) as HTMLSelectElement;
  sel.addEventListener('change', () => { store.selection.bowId = sel.value; store.persistSelection(); window.dispatchEvent(new HashChangeEvent('hashchange')); });
  return sel;
}
function arrowSelect(): HTMLElement {
  const sel = h('select', { class: 'select', style: 'min-width:260px' },
    ...store.arrows.map((a) => h('option', { value: a.id, selected: store.arrow?.id === a.id }, a.name))) as HTMLSelectElement;
  sel.addEventListener('change', () => { store.selection.arrowId = sel.value; store.persistSelection(); window.dispatchEvent(new HashChangeEvent('hashchange')); });
  return sel;
}

function kv(k: string, v: string, unit?: string, tone?: '' | 'accent' | 'good' | 'bad' | 'info'): HTMLElement {
  return h('div', { class: `kv ${tone ?? ''}` }, h('div', { class: 'k' }, k), h('div', { class: 'v', style: 'font-size:16px' }, v, unit ? h('small', null, unit) : null));
}

function softnessBar(ratio: number): HTMLElement {
  // 0.7 硬 .. 1 中 .. 1.3 软
  const pct = Math.min(100, Math.max(0, ((ratio - 0.7) / 0.6) * 100));
  return h('div', { style: 'margin:12px 0 4px' },
    h('div', { class: 'flex', style: 'justify-content:space-between;font-size:11px;color:var(--text-3)' }, h('span', { style: 'color:var(--stiff)' }, '偏硬'), h('span', null, '匹配区 0.92–1.08'), h('span', { style: 'color:var(--soft)' }, '偏软')),
    h('div', { style: 'height:10px;border-radius:999px;background:linear-gradient(90deg,var(--stiff),#3a4a63 45%,var(--green) 50%,#5a3a2c 58%,var(--soft));position:relative;margin-top:5px' },
      h('div', { style: `position:absolute;top:-3px;bottom:-3px;left:${pct}%;width:4px;border-radius:2px;background:#fff;box-shadow:0 0 8px #fff` })));
}

function proof100125(bowId?: string, arrowId?: string): HTMLElement {
  const bow = store.bows.find((b) => b.id === bowId) ?? store.bow!;
  // 固定用 600 箭做标准对照，若没有则用当前箭
  const arrow = store.arrows.find((a) => a.id === 'arr-600-30-100') ?? store.arrows.find((a) => a.id === arrowId) ?? store.arrow!;
  if (!bow || !arrow) return h('p', { class: 'muted' }, '数据不足');
  const stats = computeArrowStats(arrow, bow);
  const c100 = makeShotConfig(bow, arrow, stats, { pointWeightGr: 100 }, { seed: 5 });
  const c125 = makeShotConfig(bow, arrow, stats, { pointWeightGr: 125 }, { seed: 5 });
  const t100 = computeTear(c100);
  const t125 = computeTear(c125);
  const s100 = t100.tailHMm * t100.softSideSign;
  const s125 = t125.tailHMm * t125.softSideSign;
  const pass = s125 > s100;
  return h('div', null,
    h('p', { style: 'font-size:12.5px;color:var(--text-2)' }, `同一把 ${bow.name}，只改箭头重量。软侧坐标（含左右手镜像）：`),
    h('div', { class: 'flex mt8', style: 'justify-content:space-around;text-align:center' },
      h('div', null, h('div', { class: 'mono', style: 'font-size:22px;font-weight:800' }, s100.toFixed(1)), h('div', { class: 'muted', style: 'font-size:11px' }, '100gr mm')),
      h('div', { style: 'font-size:22px;color:var(--amber)' }, '→'),
      h('div', null, h('div', { class: 'mono', style: 'font-size:22px;font-weight:800;color:var(--soft)' }, s125.toFixed(1)), h('div', { class: 'muted', style: 'font-size:11px' }, '125gr mm 偏软方向')),
    ),
    h('div', { class: `check-row mt12`, style: 'margin-bottom:0' },
      h('div', { class: `check-ico ${pass ? 'pass' : 'fail'}` }, pass ? '✓' : '✕'),
      h('div', null, h('div', { class: 'ct' }, pass ? '方向正确：加重箭头，口子向偏软一侧移动' : '方向异常'),
        h('div', { class: 'cd' }, `Δ=${(s125 - s100).toFixed(2)}mm · f₁ ${c100.f1Hz.toFixed(1)}→${c125.f1Hz.toFixed(1)}Hz（总重上升，频率下降）`))),
  );
}
