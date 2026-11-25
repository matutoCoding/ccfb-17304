import type { PageInstance } from '../ui/page';
import { h, toast, confirmDialog } from '../ui/dom';
import { runSelfChecks } from '../core/selfcheck';
import { getSettings, saveSettings, resetAllData, idb } from '../db/database';
import { store } from '../state/store';
import type { AppSettings } from '../core/types';

export function createSettingsPage(): PageInstance {
  const root = h('div') as HTMLDivElement;
  let s: AppSettings = { ...store.settings };

  async function render(): Promise<void> {
    s = await getSettings();
    root.replaceChildren();
    root.appendChild(h('div', { class: 'section-title' },
      h('div', null, h('h2', null, '设置与物理自检'), h('p', null, '三条硬指标在此自动核验；偏好保存在 IndexedDB。'))));

    // —— 自检 ——
    const checkCard = h('div', { class: 'card mb16' });
    checkCard.appendChild(h('div', { class: 'card-h' }, h('h3', null, '推演方向 / 频率 / 确定性自检'), h('span', { class: 'spacer' }), h('button', { class: 'btn btn-sm', onClick: () => render() }, '↻ 重新检测')));
    const results = runSelfChecks();
    const allPass = results.every((r) => r.pass);
    checkCard.appendChild(h('div', { class: `badge ${allPass ? 'badge-good' : 'badge-bad'} mb8` }, allPass ? '全部通过' : '存在未通过项'));
    for (const r of results) {
      checkCard.appendChild(h('div', { class: 'check-row' },
        h('div', { class: `check-ico ${r.pass ? 'pass' : 'fail'}` }, r.pass ? '✓' : '✕'),
        h('div', null, h('div', { class: 'ct' }, r.label), h('div', { class: 'cd' }, r.detail))));
    }
    root.appendChild(checkCard);

    const grid = h('div', { class: 'grid cols-2' });

    // —— 偏好 ——
    const pref = h('div', { class: 'card' });
    pref.appendChild(h('h3', { class: 'mb8' }, '推演偏好'));
    pref.appendChild(selectRow('默认左右手', s.handedness, [['RH', '右手弓'], ['LH', '左手弓']], (v) => (s.handedness = v as 'RH' | 'LH')));
    pref.appendChild(numberRow('纸靶射距 m', s.paperDistanceM, 1, 5, 0.1, (v) => (s.paperDistanceM = v)));
    pref.appendChild(selectRow('高速相机帧率 fps', String(s.cameraFps), [['240', '240'], ['1000', '1000'], ['4000', '4000']], (v) => (s.cameraFps = +v)));
    pref.appendChild(numberRow('曝光时间 ms', s.exposureMs, 0.1, 5, 0.1, (v) => (s.exposureMs = v)));
    pref.appendChild(selectRow('默认慢放倍率', String(s.slowMo), [['1', '1×'], ['10', '10×'], ['100', '100×'], ['1000', '1000×']], (v) => (s.slowMo = +v)));
    pref.appendChild(switchRow('曝光运动拖影', s.showTrails, (v) => (s.showTrails = v)));
    pref.appendChild(switchRow('显示顶/侧双机位', s.showTopSide, (v) => (s.showTopSide = v)));
    pref.appendChild(switchRow('减弱动态效果', s.reducedMotion, (v) => (s.reducedMotion = v)));
    pref.appendChild(h('button', {
      class: 'btn btn-primary mt12', style: 'width:100%',
      onClick: async () => { await saveSettings(s); store.settings = s; toast('设置已保存'); },
    }, '保存设置'));
    grid.appendChild(pref);

    // —— 数据 ——
    const data = h('div', { class: 'card' });
    data.appendChild(h('h3', { class: 'mb8' }, '数据管理（IndexedDB）'));
    const counts = await Promise.all([idb.all('bows'), idb.all('arrows'), idb.all('sessions'), idb.all('photos')]);
    data.appendChild(h('div', { class: 'kv-grid', style: 'grid-template-columns:repeat(2,1fr)' },
      kvData('弓档案', counts[0].length), kvData('箭档案', counts[1].length), kvData('调试会话', counts[2].length), kvData('纸靶照片', counts[3].length)));
    data.appendChild(h('button', { class: 'btn mt12', style: 'width:100%', onClick: exportJson }, '⬇ 导出全部数据 JSON'));
    data.appendChild(h('button', {
      class: 'btn btn-danger mt8', style: 'width:100%',
      onClick: async () => {
        if (await confirmDialog('将清空并重建内置演示弓、箭、合成照片与示例调试过程，确定？', true)) {
          await resetAllData();
          toast('已重建演示数据，即将刷新…', 'ok', 1400);
          setTimeout(() => location.reload(), 1200);
        }
      },
    }, '↺ 恢复内置演示数据'));
    data.appendChild(h('p', { class: 'muted mt12', style: 'font-size:12px' }, '所有弓箭档案、调试记录与导入照片仅保存在本机浏览器 IndexedDB，不会上传。'));
    grid.appendChild(data);
    root.appendChild(grid);

    // —— 手册对照 ——
    const manual = h('div', { class: 'card mt16' });
    manual.appendChild(h('h3', { class: 'mb8' }, '推演方向 ↔ 调弓手册对照'));
    manual.appendChild(h('div', { style: 'overflow-x:auto' }, h('table', { class: 'manual-table' },
      h('thead', null, h('tr', null, h('th', null, '纸靶表现'), h('th', null, '主要原因'), h('th', null, '处理（改动量从小到大）'))),
      h('tbody', null,
        manualRow('口子上翘 / 高位撕痕（本店读图约定）', '搭箭点偏低', '每次 +0.5mm 上调搭箭点后复射；复合弓若无效先查偏心轮同步'),
        manualRow('口子下扎 / 低位撕痕', '搭箭点偏高、箭台过高', '每次 −0.5mm 下调搭箭点；检查箭台高度'),
        manualRow('横向撕向偏软侧（右手弓为尾左）', 'spine 偏软 / 箭头过重', '先 1/64in 移箭台、调弹性柱；根因处理为箭头减重（125→100gr）或换硬一号杆'),
        manualRow('横向撕向偏硬侧（右手弓为尾右）', 'spine 偏硬 / 箭头过轻', '加重箭头（100→125gr）压软动态 spine，或换软一号杆'),
        manualRow('杂乱多孔、方向不重复', '新手撒放/握弓不稳定', '同设置连射 3 箭取重复主方向，先稳动作再调设备'),
      ))));
    manual.appendChild(h('p', { class: 'muted mt12', style: 'font-size:12px' },
      '符号约定：纸面坐标 h 向右=射手视角右侧，v 向上；“上翘”按客户店内土办法指撕口翻翘方向。标准 paper-tune 图表以“箭尾痕相对箭头孔”命名，垂直方向词可能相反，本系统在诊断页同时给出物理尾偏毫米数，避免读图侧/命名歧义。水平软/硬方向已按左右手镜像。'));
    manual.appendChild(h('p', { class: 'muted mt8', style: 'font-size:12px' },
      '频率公式：ATA spine 为 28in 跨距、1.94lbf 中点载荷下的千分之一英寸挠度 δ，EI=FL³/(48δ)；自由-自由梁 f₁=(β₁L)²/(2πL²)·√(EI/μ)，μ=总质量/全长。推演直接以 f₁ 驱动一阶振型，故与公式严格一致。'));
    root.appendChild(manual);
  }

  render();
  return { el: root };
}

function manualRow(a: string, b: string, c: string): HTMLElement {
  return h('tr', null, h('td', null, a), h('td', null, b), h('td', null, c));
}

function selectRow(label: string, value: string, opts: [string, string][], on: (v: string) => void): HTMLElement {
  const sel = h('select', { class: 'select' }, ...opts.map(([v, l]) => h('option', { value: v, selected: v === value }, l))) as HTMLSelectElement;
  sel.addEventListener('change', () => on(sel.value));
  return h('div', { class: 'field mt8' }, h('span', { class: 'field-label' }, label), sel);
}
function numberRow(label: string, value: number, min: number, max: number, step: number, on: (v: number) => void): HTMLElement {
  const inp = h('input', { class: 'input', type: 'number', min: String(min), max: String(max), step: String(step), value: String(value) }) as HTMLInputElement;
  inp.addEventListener('change', () => on(+inp.value));
  return h('div', { class: 'field mt8' }, h('span', { class: 'field-label' }, label), inp);
}
function switchRow(label: string, value: boolean, on: (v: boolean) => void): HTMLElement {
  const cb = h('input', { type: 'checkbox' }) as HTMLInputElement;
  cb.checked = value;
  cb.addEventListener('change', () => on(cb.checked));
  return h('label', { class: 'flex mt12', style: 'justify-content:space-between;cursor:pointer;font-size:13px' },
    h('span', null, label), h('span', { class: 'switch' }, cb, h('span', { class: 'track' })));
}
function kvData(k: string, v: number): HTMLElement {
  return h('div', { class: 'kv' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, String(v)));
}

async function exportJson(): Promise<void> {
  const [bows, arrows, sessions, photos, kv] = await Promise.all([
    idb.all('bows'), idb.all('arrows'), idb.all('sessions'), idb.all('photos'), idb.all('kv'),
  ]);
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), bows, arrows, sessions, photos, kv }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bowtune-export-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('已导出 JSON（照片为 dataURL，可能较大）');
}
