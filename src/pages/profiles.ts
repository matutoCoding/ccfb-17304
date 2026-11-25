import type { PageInstance } from '../ui/page';
import { h, field, toast, confirmDialog, badge, svgCanvas } from '../ui/dom';
import { idb, emitChange } from '../db/database';
import { store } from '../state/store';
import type { ArrowProfile, BowProfile } from '../core/types';
import { computeArrowStats, drawForceCurve } from '../core/physics';
import { uid, fmt } from '../core/util';

export function createProfilesPage(): PageInstance {
  const root = h('div', null) as HTMLDivElement;
  let tab: 'bow' | 'arrow' = 'bow';

  function render(): void {
    root.replaceChildren();
    root.appendChild(
      h(
        'div',
        { class: 'section-title' },
        h('div', null, h('h2', null, '弓箭档案'), h('p', null, '反曲 / 复合分类型建档；反曲更换弓片后拉力曲线与储能随之改变。数据保存在本机 IndexedDB。')),
        h('div', { class: 'tabs' }, tabBtn('bow', '弓档案'), tabBtn('arrow', '箭档案')),
      ),
    );
    const layout = h('div', { class: 'profile-layout' });
    layout.appendChild(renderList());
    layout.appendChild(h('div', { class: 'card', id: 'editor-card' }));
    root.appendChild(layout);
    renderEditor();
  }

  function tabBtn(key: 'bow' | 'arrow', label: string): HTMLElement {
    return h('button', { class: `tab ${tab === key ? 'active' : ''}`, onClick: () => { tab = key; render(); } }, label);
  }

  function renderList(): HTMLElement {
    const wrap = h('div', { class: 'card' });
    const newBtn = h('button', {
      class: 'btn btn-primary btn-sm',
      onClick: () => {
        if (tab === 'bow') {
          const b: BowProfile = {
            id: uid('bow'), kind: 'bow', createdAt: Date.now(), name: '新弓档案', bowType: 'recurve',
            drawWeightLb: 40, ratedDrawLengthIn: 28, drawLengthIn: 28, bowLengthIn: 68, braceHeightIn: 8.5,
            handedness: 'RH', limbModel: '标准木芯片', limbLengthIn: 68, limbMarkWeightLb: 40, limbGrade: 'medium',
            nockHeightMm: 3, restCenterMm: 0, plungerPressure: 50, restType: '', notes: '',
          };
          store.selection.bowId = b.id;
          idb.put('bows', b).then(() => store.reloadBows()).then(render);
        } else {
          const a: ArrowProfile = {
            id: uid('arr'), kind: 'arrow', createdAt: Date.now(), name: '新箭型号', shaftModel: '',
            staticSpine: 500, lengthIn: 29, shaftGpi: 8.5, shaftDiameterIn: 0.28,
            pointWeightGr: 100, insertWeightGr: 15, nockWeightGr: 7,
            fletchCount: 3, vaneWeightGrEach: 5, vaneLengthIn: 2, vaneHeightMm: 9,
            fletchOffsetDeg: 1.5, helicalDeg: 1, wrapWeightGr: 5, notes: '',
          };
          store.selection.arrowId = a.id;
          idb.put('arrows', a).then(() => store.reloadArrows()).then(render);
        }
      },
    }, `＋ 新建${tab === 'bow' ? '弓' : '箭'}`);
    wrap.appendChild(h('div', { class: 'list-toolbar' }, newBtn));

    const list = h('div', { class: 'profile-list' });
    if (tab === 'bow') {
      for (const b of store.bows) {
        list.appendChild(
          h('button', {
            class: `profile-item ${store.bow?.id === b.id ? 'active' : ''}`,
            onClick: () => { store.selection.bowId = b.id; store.persistSelection(); render(); },
          },
            h('div', { class: 'pi-name' }, h('span', { class: `type-dot type-${b.bowType}` }), b.name),
            h('div', { class: 'pi-meta' }, `${b.bowType === 'recurve' ? '反曲' : '复合'} · ${b.drawWeightLb}# · 拉距 ${b.drawLengthIn}" · ${b.handedness === 'RH' ? '右手' : '左手'}${b.customerName ? ' · ' + b.customerName : ''}`),
          ),
        );
      }
    } else {
      for (const a of store.arrows) {
        list.appendChild(
          h('button', {
            class: `profile-item ${store.arrow?.id === a.id ? 'active' : ''}`,
            onClick: () => { store.selection.arrowId = a.id; store.persistSelection(); render(); },
          },
            h('div', { class: 'pi-name' }, a.name),
            h('div', { class: 'pi-meta' }, `spine ${a.staticSpine} · ${a.lengthIn}" · 箭头 ${a.pointWeightGr}gr · ${a.fletchCount} 羽`),
          ),
        );
      }
    }
    if (!list.children.length) list.appendChild(h('div', { class: 'empty' }, '暂无档案'));
    wrap.appendChild(list);
    return wrap;
  }

  function renderEditor(): void {
    const card = root.querySelector('#editor-card') as HTMLElement;
    card.replaceChildren();
    if (tab === 'bow' && store.bow) card.appendChild(bowEditor(store.bow));
    else if (tab === 'arrow' && store.arrow) card.appendChild(arrowEditor(store.arrow));
    else card.appendChild(h('div', { class: 'empty' }, '请选择或新建一份档案'));
  }

  function shellEditor(title: string, draft: { id: string }, onSave: () => Promise<void>, onDelete: () => Promise<void>, content: HTMLElement): HTMLElement {
    const saveBtn = h('button', { class: 'btn btn-primary', onClick: async () => { await onSave(); toast('档案已保存到 IndexedDB'); emitChange(tab === 'bow' ? 'bows' : 'arrows'); render(); } }, '保存档案');
    const delBtn = h('button', {
      class: 'btn btn-danger btn-sm',
      onClick: async () => {
        if (await confirmDialog('确定删除这份档案？关联调试记录不会被删除，但可能找不到档案快照。', true)) {
          await onDelete();
          toast('已删除', 'warn');
          render();
        }
      },
    }, '删除');
    return h('div', null,
      h('div', { class: 'card-h' }, h('h3', null, title), h('span', { class: 'spacer' }), delBtn, saveBtn),
      content,
    );
  }

  function bowEditor(bow: BowProfile): HTMLElement {
    const d: BowProfile = structuredClone(bow);
    const live = h('div', { class: 'mt16' });
    const curveBox = h('div', null);

    const num = (key: keyof BowProfile, label: string, step = 1, hint?: string) =>
      field(label, h('input', { class: 'input', type: 'number', step, value: String(d[key] ?? ''), onInput: (e: Event) => { (d as unknown as Record<string, unknown>)[key] = parseFloat((e.target as HTMLInputElement).value); updateLive(); } }), hint);
    const txt = (key: keyof BowProfile, label: string, hint?: string) =>
      field(label, h('input', { class: 'input', value: String(d[key] ?? ''), onInput: (e: Event) => { (d as unknown as Record<string, unknown>)[key] = (e.target as HTMLInputElement).value; } }), hint);
    const sel = (key: keyof BowProfile, label: string, options: [string, string][]) =>
      field(label, h('select', { class: 'select', onInput: (e: Event) => { (d as unknown as Record<string, unknown>)[key] = (e.target as HTMLSelectElement).value; updateLive(); } },
        ...options.map(([v, l]) => h('option', { value: v, selected: d[key] === v }, l))));

    const form = h('div', { class: 'form-grid' },
      txt('name', '档案名称'),
      txt('customerName', '客户称呼'),
      sel('bowType', '弓类型', [['recurve', '反曲弓'], ['compound', '复合弓']]),
      sel('handedness', '左右手', [['RH', '右手弓（左手持弓）'], ['LH', '左手弓']]),
      num('drawWeightLb', '拉力 / 峰值磅数 #', 0.5),
      num('drawLengthIn', '客户拉距 in', 0.25),
      num('ratedDrawLengthIn', '标称磅数拉距 in', 0.25),
      num('braceHeightIn', '弦距 in', 0.125),
      num('bowLengthIn', '弓长 AMO in', 1),
      txt('restType', '箭台型号'),
      // 反曲字段
      ...(d.bowType === 'recurve'
        ? [
            txt('limbModel', '弓片型号'),
            sel('limbGrade', '弓片等级/曲线', [['short', '短/硬梢（前重）'], ['medium', '中等'], ['long', '长/柔顺']]),
            num('limbMarkWeightLb', '弓片标称磅数 #', 1),
            num('limbLengthIn', '弓片长度 in', 1),
          ]
        : [
            txt('camModel', '偏心轮型号'),
            num('letOffPct', '让力比（省力比）%', 1),
            num('axleToAxleIn', '轮轴距 in', 0.25),
          ]),
      num('nockHeightMm', '当前搭箭点高度 mm', 0.1),
      num('restCenterMm', '箭台中心距 mm（+向右）', 0.1),
      num('plungerPressure', '弹性柱压力 0-100', 1),
      field('备注', h('textarea', { class: 'textarea', onInput: (e: Event) => { d.notes = (e.target as HTMLTextAreaElement).value; } }, d.notes ?? '')),
    );

    function updateLive(): void {
      live.replaceChildren();
      curveBox.replaceChildren(renderDFC(d));
      const e = computeArrowStats(store.arrow ?? ({} as ArrowProfile), d);
      live.appendChild(h('div', { class: 'kv-grid' },
        kv('储能', fmt(e.storedEnergyJ, 1), 'J', 'accent'),
        kv('估算初速', fmt(e.launchSpeedMps, 1), 'm/s', 'info'),
        kv('拉程', fmt((d.drawLengthIn - d.braceHeightIn) * 25.4, 0), 'mm'),
        kv('建议搭箭点', d.bowType === 'recurve' ? '+3.0' : '+0.5', 'mm', 'good'),
      ));
    }
    updateLive();

    const content = h('div', null, form, h('div', { class: 'card-h mt16' }, h('h3', null, '拉力曲线 DFC'), h('span', { class: 'hint' }, d.bowType === 'recurve' ? '换弓片等级，曲线饱满度变化' : '末段跌入 let-off 谷区')), curveBox, live);
    return shellEditor('编辑弓档案', d,
      async () => { await idb.put('bows', d); store.selection.bowId = d.id; store.persistSelection(); await store.reloadBows(); },
      async () => { await idb.del('bows', d.id); store.bows = store.bows.filter((b) => b.id !== d.id); store.selection.bowId = store.bows[0]?.id; store.persistSelection(); },
      content);
  }

  function arrowEditor(arrow: ArrowProfile): HTMLElement {
    const d: ArrowProfile = structuredClone(arrow);
    const live = h('div', { class: 'mt16' });
    const num = (key: keyof ArrowProfile, label: string, step = 1, hint?: string) =>
      field(label, h('input', { class: 'input', type: 'number', step, value: String(d[key] ?? ''), onInput: (e: Event) => { (d as unknown as Record<string, unknown>)[key] = parseFloat((e.target as HTMLInputElement).value); updateLive(); } }), hint);
    const txt = (key: keyof ArrowProfile, label: string) =>
      field(label, h('input', { class: 'input', value: String(d[key] ?? ''), onInput: (e: Event) => { (d as unknown as Record<string, unknown>)[key] = (e.target as HTMLInputElement).value; } }));

    const form = h('div', { class: 'form-grid' },
      h('div', { class: 'full' }, txt('name', '箭档案名称')),
      txt('shaftModel', '箭杆型号'),
      num('staticSpine', '静态 spine', 10, 'ATA 挠度值，越大越软'),
      num('lengthIn', '箭杆长度 in', 0.125),
      num('shaftGpi', '杆重 GPI gr/in', 0.1),
      num('shaftDiameterIn', '杆外径 in', 0.001),
      num('pointWeightGr', '箭头重量 gr', 5),
      num('insertWeightGr', '插销/箭座 gr', 1),
      num('nockWeightGr', '箭尾 gr', 0.5),
      num('wrapWeightGr', '缠绕/热缩 gr', 0.5),
      num('fletchCount', '羽片数 3/4', 1),
      num('vaneWeightGrEach', '单片羽重 gr', 0.1),
      num('vaneLengthIn', '羽长 in', 0.125),
      num('vaneHeightMm', '羽高 mm', 0.5),
      num('fletchOffsetDeg', '粘羽偏置角 °', 0.25),
      num('helicalDeg', '螺旋角 °', 0.25),
      h('div', { class: 'full' }, field('备注', h('textarea', { class: 'textarea', onInput: (e: Event) => { d.notes = (e.target as HTMLTextAreaElement).value; } }, d.notes ?? ''))),
    );

    function updateLive(): void {
      const s = computeArrowStats(d, store.bow);
      const tone = s.verdict === 'soft' ? 'bad' : s.verdict === 'stiff' ? 'info' : 'good';
      const verdictText = s.verdict === 'soft' ? '偏软' : s.verdict === 'stiff' ? '偏硬' : '匹配';
      live.replaceChildren(
        h('div', { class: 'card-h' }, h('h3', null, '自动配箭计算'), h('span', { class: 'spacer' }), badge(verdictText, s.verdict === 'soft' ? 'bad' : s.verdict === 'stiff' ? 'info' : 'good')),
        h('div', { class: 'kv-grid' },
          kv('总重', fmt(s.totalWeightGr, 1), 'gr'),
          kv('FOC', fmt(s.focPct, 1), '%', s.focPct >= 7 && s.focPct <= 18 ? 'good' : 'accent'),
          kv('重心', fmt(s.balancePointIn, 2), 'in from nock'),
          kv('动态 spine', fmt(s.dynamicSpine, 0), '', tone),
          kv('弓需求 spine', fmt(s.bowRequiredSpine, 0), '', 'info'),
          kv('软硬比', fmt(s.spineRatio, 3), '×', tone),
          kv('EI', fmt(s.eiNm2, 2), 'N·m²'),
          kv('一阶频率', fmt(s.beamF1Hz, 1), 'Hz', 'accent'),
        ),
        h('p', { class: 'muted mt8', style: 'font-size:12px' },
          `梁公式自由-自由边界：f₁=(β₁L)²/(2πL²)·√(EI/μ)，μ=总质量/全长。当前对照弓：${store.bow?.name ?? '未选'}（${store.bow?.drawWeightLb ?? '—'}#）。`),
      );
    }
    updateLive();

    return shellEditor('编辑箭档案', d,
      async () => { await idb.put('arrows', d); store.selection.arrowId = d.id; store.persistSelection(); await store.reloadArrows(); },
      async () => { await idb.del('arrows', d.id); store.arrows = store.arrows.filter((a) => a.id !== d.id); store.selection.arrowId = store.arrows[0]?.id; store.persistSelection(); },
      h('div', null, form, live));
  }

  render();
  return { el: root };
}

function kv(k: string, v: string, unit?: string, tone?: '' | 'accent' | 'good' | 'bad' | 'info'): HTMLElement {
  return h('div', { class: `kv ${tone ?? ''}` }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v, unit ? h('small', null, unit) : null));
}

/** DFC 拉力曲线 SVG */
function renderDFC(bow: BowProfile): HTMLElement {
  const pts = drawForceCurve(bow);
  const W = 560;
  const H = 210;
  const padL = 46;
  const padR = 16;
  const padT = 16;
  const padB = 34;
  const xs = pts.map((p) => p.drawIn);
  const ys = pts.map((p) => p.weightLb);
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);
  const ymax = Math.max(...ys) * 1.08;
  const X = (x: number) => padL + ((x - xmin) / (xmax - xmin)) * (W - padL - padR);
  const Y = (y: number) => H - padB - (y / ymax) * (H - padT - padB);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.drawIn).toFixed(1)},${Y(p.weightLb).toFixed(1)}`).join(' ');
  const area = `${path} L${X(xmax)},${H - padB} L${X(xmin)},${H - padB} Z`;
  const gridLines = [0.25, 0.5, 0.75, 1].map((f) => {
    const yv = ymax * f;
    return `<line x1="${padL}" y1="${Y(yv)}" x2="${W - padR}" y2="${Y(yv)}" stroke="#2a3548" stroke-dasharray="3 4"/>
      <text x="${padL - 7}" y="${Y(yv) + 4}" text-anchor="end" font-size="10" fill="#76849c">${Math.round(yv)}#</text>`;
  }).join('');
  const anchorX = X(bow.ratedDrawLengthIn || 28);
  const svg = svgCanvas(W, H, `
      ${gridLines}
      <path d="${area}" fill="rgba(242,180,65,0.12)"/>
      <path d="${path}" fill="none" stroke="#f2b441" stroke-width="2.4"/>
      <line x1="${anchorX}" y1="${padT}" x2="${anchorX}" y2="${H - padB}" stroke="#46d3e8" stroke-dasharray="5 4"/>
      <text x="${anchorX + 5}" y="${padT + 10}" font-size="10.5" fill="#46d3e8">额定 ${bow.ratedDrawLengthIn}"</text>
      <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#3d4c68"/>
      <text x="${W / 2}" y="${H - 10}" text-anchor="middle" font-size="11" fill="#aab7cc">拉距 in</text>
      <text transform="translate(14 ${H / 2}) rotate(-90)" text-anchor="middle" font-size="11" fill="#aab7cc">拉力 lb</text>
      <text x="${X(xmin)}" y="${H - padB + 16}" text-anchor="middle" font-size="10" fill="#76849c">${xmin.toFixed(1)}</text>
      <text x="${X(xmax)}" y="${H - padB + 16}" text-anchor="middle" font-size="10" fill="#76849c">${xmax.toFixed(1)}</text>
    `);
  svg.style.display = 'block';
  return h('div', { class: 'tear-canvas-wrap', style: 'background:var(--panel-2);padding:6px' }, svg);
}
