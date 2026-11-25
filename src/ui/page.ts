// 页面实例契约：el 挂到 outlet，destroy 在切路由时释放 three/监听。
export interface PageInstance {
  el: HTMLElement;
  destroy?: () => void;
}
