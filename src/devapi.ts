// 暴露给自动化/控制台的核验入口（不影响 UI）。
import { store } from './state/store';
import { runSelfChecks, measureMode1Frequency } from './core/selfcheck';
import * as physics from './core/physics';
import * as shot from './core/shot';
import * as diagnose from './core/diagnose';
import * as ballistics from './core/ballistics';

declare global {
  interface Window {
    __BOWTUNE__?: unknown;
  }
}

window.__BOWTUNE__ = {
  store,
  runSelfChecks,
  measureMode1Frequency,
  ...physics,
  ...shot,
  ...diagnose,
  ...ballistics,
  version: '1.0.0',
};
