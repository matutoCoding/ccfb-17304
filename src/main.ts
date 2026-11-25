import './styles.css';
import './devapi';
import { h } from './ui/dom';
import { ensureSeeded } from './db/database';
import { store } from './state/store';
import type { PageInstance } from './ui/page';

import { createProfilesPage } from './pages/profiles';
import { createMatchPage } from './pages/match';
import { createSimPage } from './pages/sim';
import { createDiagnosePage } from './pages/diagnose';
import { createRecordsPage } from './pages/records';
import { createSettingsPage } from './pages/settings';

const NAV = [
  { hash: '#/profiles', label: '弓箭档案', icon: iconBow },
  { hash: '#/match', label: '配箭计算', icon: iconCalc },
  { hash: '#/sim', label: '出箭推演', icon: iconPlay },
  { hash: '#/diagnose', label: '纸靶诊断', icon: iconTarget },
  { hash: '#/records', label: '调试记录', icon: iconHistory },
  { hash: '#/settings', label: '设置自检', icon: iconGear },
];

function iconBow(): string {
  return `<svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 3c8 1 14 7 15 18"/><path d="M5 3c-1 7 1 13 6 17"/><path d="M4 12h16"/><path d="M17 9l3 3-3 3"/></svg>`;
}
function iconCalc(): string {
  return `<svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15v4M8 19h4"/></svg>`;
}
function iconPlay(): string {
  return `<svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 5l16 7-16 7z"/><path d="M4 5v14" opacity=".5"/></svg>`;
}
function iconTarget(): string {
  return `<svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke-linecap="round"/></svg>`;
}
function iconHistory(): string {
  return `<svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 8v4l3 2"/></svg>`;
}
function iconGear(): string {
  return `<svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z"/></svg>`;
}

async function bootstrap(): Promise<void> {
  const loading = h('div', { class: 'loading-screen' }, h('div', { class: 'spinner' }), h('div', null, '正在建立弓箭档案与 IndexedDB…'));
  document.body.appendChild(loading);
  await ensureSeeded();
  await store.init();
  loading.remove();

  const outlet = h('main', { class: 'main' });
  const navButtons = NAV.map((n) =>
    h(
      'button',
      {
        class: 'nav-item',
        dataset: { hash: n.hash },
        onClick: () => {
          location.hash = n.hash;
          document.querySelector('.sidebar')?.classList.remove('open');
        },
      },
      h('span', { html: n.icon() }),
      h('span', null, n.label),
    ),
  );

  const sidebar = h(
    'aside',
    { class: 'sidebar' },
    h(
      'div',
      { class: 'brand' },
      h('div', { class: 'brand-mark', html: iconTarget() }),
      h('div', null, h('div', { class: 'brand-name' }, '纸靶调弓推演台'), h('div', { class: 'brand-sub' }, 'Paper Tune Lab')),
    ),
    ...navButtons,
    h('div', { class: 'nav-foot' }, '档案 / 记录仅存本机 IndexedDB · 物理方向对齐白纸调弓手册'),
  );

  const menuBtn = h('button', { class: 'icon-btn sidebar-toggle', 'aria-label': '菜单', onClick: () => sidebar.classList.toggle('open') }, '☰');

  const shell = h('div', { class: 'app-shell' }, sidebar, h('div', { style: 'min-width:0' }, menuBtn, outlet));
  document.querySelector('#app')!.appendChild(shell);

  let current: PageInstance | null = null;
  const routes: Record<string, () => PageInstance | Promise<PageInstance>> = {
    '/profiles': createProfilesPage,
    '/match': createMatchPage,
    '/sim': createSimPage,
    '/diagnose': createDiagnosePage,
    '/records': createRecordsPage,
    '/settings': createSettingsPage,
  };

  async function renderRoute(): Promise<void> {
    const raw = location.hash.replace(/^#/, '') || '/profiles';
    const path = routes[raw] ? raw : '/profiles';
    navButtons.forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.hash === `#${path}`));
    current?.destroy?.();
    outlet.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'big' }, '⏳'), '页面加载中…'));
    const page = await routes[path]();
    current = page;
    outlet.replaceChildren(page.el);
    window.scrollTo({ top: 0 });
  }

  window.addEventListener('hashchange', renderRoute);
  if (!location.hash) location.hash = '#/profiles';
  await renderRoute();
}

bootstrap().catch((e) => {
  console.error(e);
  const app = document.querySelector('#app');
  if (app) app.innerHTML = `<div class="empty"><div class="big">⚠️</div>启动失败：${(e as Error).message}</div>`;
});
