// 轻量 hyperscript / 组件工具，避免引入框架。
export type Child = Node | string | number | false | null | undefined | Child[];

export type Props = {
  class?: string;
  id?: string;
  html?: string;
  style?: Partial<CSSStyleDeclaration> | string;
  attrs?: Record<string, string | number | boolean | undefined | null>;
  dataset?: Record<string, string | number>;
  [key: string]: unknown;
} & {
  [K in `on${string}`]?: EventListenerOrEventListenerObject;
};

export function h(tag: string, props?: Props | null, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, val] of Object.entries(props)) {
      if (val === undefined || val === null || val === false) continue;
      if (key === 'class') el.className = String(val);
      else if (key === 'id') el.id = String(val);
      else if (key === 'html') el.innerHTML = String(val);
      else if (key === 'style') {
        if (typeof val === 'string') el.setAttribute('style', val);
        else Object.assign(el.style, val);
      } else if (key === 'attrs') {
        for (const [a, v] of Object.entries(val as Record<string, unknown>)) {
          if (v === undefined || v === null || v === false) continue;
          if (v === true) el.setAttribute(a, '');
          else el.setAttribute(a, String(v));
        }
      } else if (key === 'dataset') {
        for (const [d, v] of Object.entries(val as Record<string, string | number>)) el.dataset[d] = String(v);
      } else if (key.startsWith('on') && typeof val === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), val as EventListener);
      } else if (key in el && key !== 'list') {
        try {
          (el as unknown as Record<string, unknown>)[key] = val;
        } catch {
          el.setAttribute(key, String(val));
        }
      } else {
        el.setAttribute(key, String(val));
      }
    }
  }
  appendChildren(el, children);
  return el;
}

export function appendChildren(el: HTMLElement, children: Child[]): void {
  for (const c of children.flat()) {
    if (c === false || c === null || c === undefined) continue;
    if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

export function mount(el: HTMLElement, children: Child[]): void {
  clear(el);
  appendChildren(el, children);
}

// —— Toast ——
let toastHost: HTMLDivElement | null = null;
export function toast(message: string, type: 'ok' | 'warn' | 'err' = 'ok', timeout = 2600): void {
  if (!toastHost) {
    toastHost = h('div', { class: 'toast-host' }) as HTMLDivElement;
    document.body.appendChild(toastHost);
  }
  const t = h('div', { class: `toast toast-${type}` }, message);
  toastHost.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 250);
  }, timeout);
}

// —— Modal ——
export interface ModalHandle {
  close: () => void;
  body: HTMLDivElement;
}
export function modal(title: string, content: Node, opts?: { width?: string; footer?: Node[] }): ModalHandle {
  const overlay = h('div', { class: 'modal-overlay' });
  const body = h('div', { class: 'modal-body' }) as HTMLDivElement;
  const close = () => {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 180);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  const head = h('div', { class: 'modal-head' }, h('h3', null, title), h('button', { class: 'icon-btn', onClick: close, 'aria-label': '关闭' }, '✕'));
  const box = h('div', { class: 'modal', style: opts?.width ? `max-width:${opts.width}` : undefined }, head, body);
  body.appendChild(content);
  if (opts?.footer) {
    const foot = h('div', { class: 'modal-foot' }, ...opts.footer);
    box.appendChild(foot);
  }
  overlay.appendChild(box);
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
  return { close, body };
}

export function confirmDialog(message: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let handle: ModalHandle;
    const yes = h(
      'button',
      {
        class: danger ? 'btn btn-danger' : 'btn btn-primary',
        onClick: () => {
          handle.close();
          resolve(true);
        },
      },
      '确定',
    );
    const no = h(
      'button',
      {
        class: 'btn',
        onClick: () => {
          handle.close();
          resolve(false);
        },
      },
      '取消',
    );
    handle = modal('请确认', h('p', { class: 'confirm-text' }, message), { footer: [no, yes], width: '420px' });
  });
}

/** 表单字段包装 */
export function field(label: string, input: HTMLElement, hint?: string): HTMLElement {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('span', { class: 'field-hint' }, hint) : null);
}

export function sectionTitle(title: string, sub?: string, extra?: Child): HTMLElement {
  return h('div', { class: 'section-title' }, h('div', null, h('h2', null, title), sub ? h('p', null, sub) : null), extra ?? null);
}

export function badge(text: string, tone: 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'soft' | 'stiff' = 'neutral'): HTMLElement {
  return h('span', { class: `badge badge-${tone}` }, text);
}

/** 用 HTML 解析器生成带正确命名空间的 SVG（内部直接写 SVG 标记字符串） */
export function svgCanvas(viewBoxW: number, viewBoxH: number, inner: string): SVGSVGElement {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxW} ${viewBoxH}" style="width:100%;height:auto;display:block">${inner}</svg>`;
  return wrap.firstElementChild as SVGSVGElement;
}
