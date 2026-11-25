import type { PageInstance } from '../ui/page';
import { h, badge, modal, toast } from '../ui/dom';
import { store } from '../state/store';
import type { TuneSession } from '../core/types';
import { drawPaperTear } from '../ui/tearDraw';
import { createSession } from '../state/records';
import { idb } from '../db/database';

export function createRecordsPage(): PageInstance {
  const root = h('div') as HTMLDivElement;
  let session: TuneSession | undefined = store.session;
  let active = session ? session.steps.length - 1 : 0;
  let compareA = Math.max(0, active - 1);
  let compareB = active;
  let playTimer: number | null = null;

  function stopPlay(): void {
    if (playTimer !== null) {
      clearInterval(playTimer);
      playTimer = null;
    }
  }

  function render(): void {
    stopPlay();
    session = store.sessions.find((s) => s.id === store.selection.sessionId) ?? store.sessions[0];
    if (session) {
      store.selection.sessionId = session.id;
      if (active >= session.steps.length) active = Math.max(0, session.steps.length - 1);
      compareB = Math.min(compareB, session.steps.length - 1);
      compareA = Math.min(compareA, session.steps.length - 1);
    }
    root.replaceChildren();
    root.appendChild(header());
    if (!session || !session.steps.length) {
      root.appendChild(h('div', { class: 'empty' }, h('div', { class: 'big' }, '🗂️'), '还没有调试步骤。到出箭推演或纸靶诊断里“记一步”，或新建一个客户调试。'));
      return;
    }
    root.appendChild(rail());
    const grid = h('div', { class: 'layout-diag mt16' });
    grid.appendChild(stepDetail());
    grid.appendChild(rightCol());
    root.appendChild(grid);
  }

  function header(): HTMLElement {
    const sel = h('select', { class: 'select', style: 'min-width:240px' },
      ...store.sessions.map((s) => h('option', { value: s.id, selected: session?.id === s.id }, `${s.customerName} · ${s.steps.length} 步`))) as HTMLSelectElement;
    sel.addEventListener('change', async () => {
      store.selection.sessionId = sel.value;
      store.persistSelection();
      session = store.sessions.find((s) => s.id === sel.value);
      active = session ? session.steps.length - 1 : 0;
      compareA = Math.max(0, active - 1);
      compareB = active;
      render();
    });
    const newBtn = h('button', { class: 'btn btn-primary', onClick: newSessionDialog }, '＋ 新客户调试');
    const playBtn = h('button', { class: 'btn btn-cyan' }, '▶ 从头回放') as HTMLButtonElement;
    playBtn.addEventListener('click', () => {
      if (playTimer !== null) { stopPlay(); playBtn.textContent = '▶ 从头回放'; return; }
      active = 0;
      render();
      const tick = () => {
        if (!session) return;
        active++;
        if (active >= session.steps.length) { stopPlay(); render(); return; }
        render();
        playTimer = window.setTimeout(tick, 1900) as unknown as number;
      };
      playTimer = window.setTimeout(tick, 1900) as unknown as number;
      playBtn.textContent = '⏸ 停止回放';
    });
    return h('div', { class: 'section-title' },
      h('div', null, h('h2', null, '调试记录与回放'), h('p', null, '每次调整留一步，前后纸靶口子叠加对比，整套客户调试可从头回放。数据在 IndexedDB。')),
      h('div', { class: 'flex' }, sel, playBtn, newBtn));
  }

  function rail(): HTMLElement {
    const s = session!;
    const railEl = h('div', { class: 'step-rail' });
    s.steps.forEach((st, i) => {
      railEl.appendChild(h('div', { class: `step-node ${i === active ? 'active' : ''}`, onClick: () => { active = i; compareB = i; render(); } },
        h('div', { class: 'step-dot' }, String(i + 1)),
        h('div', { class: 'sn-title' }, st.title),
        h('div', { class: 'sn-changes' }, st.changes[0] ?? '初始状态')));
    });
    return h('div', { class: 'card' }, railEl);
  }

  function stepDetail(): HTMLElement {
    const s = session!;
    const st = s.steps[active];
    const bow = store.bows.find((b) => b.id === s.bowId);
    const arrow = store.arrows.find((a) => a.id === st.arrowId);
    const cv = document.createElement('canvas');
    cv.width = 460;
    cv.height = 380;
    requestAnimationFrame(() => {
      const ctx = cv.getContext('2d')!;
      ctx.fillStyle = '#f2eddd';
      ctx.fillRect(0, 0, cv.width, cv.height);
      drawPaperTear(ctx, st.tear, cv.width / 2, cv.height / 2, 2.4);
    });

    const photo = st.photoId ? store.photos.find((p) => p.id === st.photoId) : undefined;
    const paramKv = h('div', { class: 'kv-grid mt12' },
      mini('搭箭点', st.params.nockHeightMm.toFixed(1), 'mm'),
      mini('箭台中心', st.params.restCenterMm.toFixed(1), 'mm'),
      mini('弹性柱', String(st.params.plungerPressure), '格'),
      mini('箭头', String(st.params.pointWeightGr), 'gr'));

    return h('div', { class: 'card' },
      h('div', { class: 'card-h' }, h('h3', null, `第 ${active + 1} 步 · ${st.title}`), h('span', { class: 'spacer' }),
        badge(st.tear.vertical === 'high' ? '上翘' : st.tear.vertical === 'low' ? '下扎' : '垂直正', st.tear.vertical === 'none' ? 'good' : 'warn'),
        badge(st.tear.horizontal === 'soft' ? '偏软' : st.tear.horizontal === 'stiff' ? '偏硬' : '水平正', st.tear.horizontal === 'soft' ? 'soft' : st.tear.horizontal === 'stiff' ? 'stiff' : 'good'),
        st.contactCount ? badge(`擦羽×${st.contactCount}`, 'bad') : badge('无擦羽', 'good')),
      st.note ? h('p', { class: 'muted', style: 'font-size:13px;margin-bottom:8px' }, st.note) : null,
      st.changes.length ? h('div', { class: 'pill-row mb8' }, ...st.changes.map((c) => badge(c, 'info'))) : null,
      h('div', { class: 'grid cols-2', style: 'align-items:start' },
        h('div', { class: 'tear-canvas-wrap' }, cv),
        h('div', null,
          paramKv,
          h('div', { class: 'stat-line mt12' }, h('span', { class: 'k' }, '弓')), h('div', { style: 'font-size:12.5px' }, bow?.name ?? s.bowId),
          h('div', { class: 'stat-line' }, h('span', { class: 'k' }, '箭')), h('div', { style: 'font-size:12.5px' }, arrow?.name ?? st.arrowId),
          photo ? h('div', { class: 'mt12' }, h('div', { class: 'field-label mb8' }, '关联实射照片'), h('img', { src: photo.dataUrl, style: 'width:100%;border-radius:10px;border:1px solid var(--line)' })) : null,
          h('button', { class: 'btn btn-danger btn-sm mt16', onClick: async () => {
            if (!confirm('删除这一步？')) return;
            s.steps.splice(active, 1);
            s.updatedAt = Date.now();
            await idb.put('sessions', s);
            await store.reloadSessions();
            if (active >= s.steps.length) active = Math.max(0, s.steps.length - 1);
            render();
            toast('步骤已删除', 'warn');
          } }, '删除本步'),
        ),
      ),
      h('div', { class: 'mt16' }, h('div', { class: 'field-label mb8' }, '本步建议（按改动量排序）'),
        ...st.advices.slice(0, 4).map((a, i) => h('div', { class: `advice-item prio-${Math.min(3, i)}`, style: 'margin-bottom:7px' },
          h('div', { class: 'advice-top' }, h('span', { class: 't' }, a.title), h('span', { class: 'advice-delta' }, a.deltaText)),
          h('div', { class: 'advice-dir' }, a.direction)))));
  }

  function rightCol(): HTMLElement {
    const s = session!;
    const aSel = h('select', { class: 'select btn-sm', style: 'width:auto' },
      ...s.steps.map((st, i) => h('option', { value: String(i), selected: i === compareA }, `A · ${i + 1}. ${st.title.slice(0, 12)}`))) as HTMLSelectElement;
    const bSel = h('select', { class: 'select btn-sm', style: 'width:auto' },
      ...s.steps.map((st, i) => h('option', { value: String(i), selected: i === compareB }, `B · ${i + 1}. ${st.title.slice(0, 12)}`))) as HTMLSelectElement;
    aSel.addEventListener('change', () => { compareA = +aSel.value; drawCompare(); });
    bSel.addEventListener('change', () => { compareB = +bSel.value; drawCompare(); });

    const cv = document.createElement('canvas');
    cv.width = 520;
    cv.height = 440;
    const drawCompare = () => {
      const ctx = cv.getContext('2d')!;
      ctx.fillStyle = '#f2eddd';
      ctx.fillRect(0, 0, cv.width, cv.height);
      const ta = s.steps[compareA].tear;
      const tb = s.steps[compareB].tear;
      const maxLen = Math.max(ta.lengthMm, tb.lengthMm, 30);
      const scale = Math.min(3.4, (Math.min(cv.width, cv.height) / 2 - 60) / maxLen);
      drawPaperTear(ctx, ta, cv.width / 2, cv.height / 2, scale, { outline: true, outlineColor: '#f2b441', lineWidthPx: 3 });
      drawPaperTear(ctx, tb, cv.width / 2, cv.height / 2, scale, { outline: true, outlineColor: '#17b6d6', lineWidthPx: 3 });
      // 图例
      ctx.font = 'bold 15px sans-serif';
      ctx.fillStyle = '#c98a1e';
      ctx.fillText(`A 第${compareA + 1}步`, 18, 26);
      ctx.fillStyle = '#0e7f99';
      ctx.fillText(`B 第${compareB + 1}步`, 18, 48);
    };
    requestAnimationFrame(drawCompare);

    return h('div', { class: 'side-panel' },
      h('div', { class: 'card' },
        h('div', { class: 'card-h' }, h('h3', null, '前后两步口子叠加')),
        h('div', { class: 'flex-wrap flex mb8' }, aSel, bSel),
        h('div', { class: 'compare-wrap' }, cv),
        h('div', { class: 'legend' },
          h('span', null, h('span', { class: 'dot', style: 'background:#f2b441' }), `A：${s.steps[compareA].tear.angleDeg.toFixed(0)}° / ${s.steps[compareA].tear.lengthMm.toFixed(0)}mm`),
          h('span', null, h('span', { class: 'dot', style: 'background:#17b6d6' }), `B：${s.steps[compareB].tear.angleDeg.toFixed(0)}° / ${s.steps[compareB].tear.lengthMm.toFixed(0)}mm`))),
      summaryCard());
  }

  function summaryCard(): HTMLElement {
    const s = session!;
    const first = s.steps[0].tear;
    const last = s.steps[s.steps.length - 1].tear;
    const shrinkH = Math.abs(first.tailHMm) - Math.abs(last.tailHMm);
    const shrinkV = Math.abs(first.tailVMm) - Math.abs(last.tailVMm);
    return h('div', { class: 'card' },
      h('div', { class: 'card-h' }, h('h3', null, '整套收敛情况')),
      h('div', { class: 'stat-line' }, h('span', { class: 'k' }, '水平撕痕收敛'), h('span', { class: 'v', style: `color:${shrinkH >= 0 ? 'var(--green)' : 'var(--red)'}` }, `${shrinkH >= 0 ? '↓' : '↑'} ${Math.abs(shrinkH).toFixed(1)}mm`)),
      h('div', { class: 'stat-line' }, h('span', { class: 'k' }, '垂直撕痕收敛'), h('span', { class: 'v', style: `color:${shrinkV >= 0 ? 'var(--green)' : 'var(--red)'}` }, `${shrinkV >= 0 ? '↓' : '↑'} ${Math.abs(shrinkV).toFixed(1)}mm`)),
      h('div', { class: 'stat-line' }, h('span', { class: 'k' }, '总步数'), h('span', { class: 'v' }, String(s.steps.length))),
      h('p', { class: 'muted mt8', style: 'font-size:12px' }, '纸靶调顺后，到出箭推演的“18/30m 远距落点”比较裸杆与带羽组心。'));
  }

  function newSessionDialog(): void {
    const nameInp = h('input', { class: 'input', placeholder: '客户称呼，如：王哥' }) as HTMLInputElement;
    const body = h('div', null,
      h('div', { class: 'field mb8' }, h('span', { class: 'field-label' }, '客户称呼'), nameInp),
      h('p', { class: 'muted', style: 'font-size:12px' }, `将使用当前选中的弓「${store.bow?.name ?? ''}」和箭「${store.arrow?.name ?? ''}」。`));
    const ok = h('button', { class: 'btn btn-primary', onClick: async () => {
      const s = await createSession(nameInp.value.trim() || '散客', store.bow!.id, store.arrow!.id);
      handle.close();
      toast(`已为 ${s.customerName} 建立调试会话`);
      active = 0;
      render();
    } }, '建立');
    const cancel = h('button', { class: 'btn', onClick: () => handle.close() }, '取消');
    const handle = modal('新建客户调试', body, { footer: [cancel, ok], width: '440px' });
    setTimeout(() => nameInp.focus(), 60);
  }

  render();
  return { el: root, destroy: stopPlay };
}

function mini(k: string, v: string, unit: string): HTMLElement {
  return h('div', { class: 'kv' }, h('div', { class: 'k' }, k), h('div', { class: 'v', style: 'font-size:16px' }, v, h('small', null, unit)));
}
