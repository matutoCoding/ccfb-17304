// ============================================================
// 出箭推演 three.js 视图
//  - 箭杆细长梁：顶点着色器按 φ1/φ2 振型叠加弯曲（不逐帧换模型）
//  - 自由-自由梁振型由 core 同一函数烘焙成 DataTexture 供 GPU 采样
//  - 透视主机位 + 顶视 + 侧视，同一 t、同一 renderer scissor 同步
//  - 曝光时间内多帧 ghost 采样 -> 运动拖影
//  - 擦箭羽事件标记每帧锚定到弯曲/旋转后的羽片位置
// ============================================================

import * as THREE from 'three';
import type { ContactEvent, ShotConfig } from '../core/types';
import {
  bendAtS,
  detectContacts,
  freeFreeModes,
  paperTimeS,
  poseAt,
  powerS,
  softSideSign,
  vanePointWorld,
} from '../core/shot';
import { drawPaperTear } from '../ui/tearDraw';
import { computeTear } from '../core/shot';

interface LabelEls {
  main?: HTMLElement;
  top?: HTMLElement;
  side?: HTMLElement;
}
interface Rect {
  css: { left: number; top: number; width: number; height: number };
  gl: { x: number; y: number; w: number; h: number };
}

interface ArrowRig {
  group: THREE.Group;
  uniforms: Record<string, THREE.IUniform>;
  setPose: (t: number) => void;
  setOpacity?: (a: number) => void;
}

let sharedModeTex: THREE.DataTexture | null = null;
function getModeTexture(): THREE.DataTexture {
  if (sharedModeTex) return sharedModeTex;
  const N = 256;
  const data = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    const [p1, p2] = freeFreeModes(u);
    data[i * 4] = Math.round((p1 * 0.5 + 0.5) * 255);
    data[i * 4 + 1] = Math.round((p2 * 0.5 + 0.5) * 255);
    data[i * 4 + 2] = 128;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  sharedModeTex = tex;
  return tex;
}

function injectBend(material: THREE.Material, uniforms: Record<string, THREE.IUniform>, Lm: number): void {
  const anyMat = material as THREE.MeshStandardMaterial;
  anyMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      'uniform sampler2D uModeTex;\n' +
      'uniform float uQy1; uniform float uQz1; uniform float uQy2; uniform float uQz2;\n' +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       float bendU = clamp((position.x + ${(Lm / 2).toFixed(5)}) / ${Lm.toFixed(5)}, 0.0, 1.0);
       vec2 bendM = texture2D(uModeTex, vec2(bendU, 0.5)).rg * 2.0 - 1.0;
       transformed.y += uQy1 * bendM.r + uQy2 * bendM.g;
       transformed.z += uQz1 * bendM.r + uQz2 * bendM.g;`,
    );
  };
  anyMat.customProgramCacheKey = () => `bend-${Lm.toFixed(4)}`;
}

export class LaunchScene {
  private container: HTMLElement;
  private labels: LabelEls;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private persp = new THREE.PerspectiveCamera(46, 1, 0.01, 60);
  private topCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 50);
  private sideCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 50);
  private ro: ResizeObserver;
  private raf = 0;
  private disposed = false;

  private cfg: ShotConfig | null = null;
  private signature = '';
  private mainRig: ArrowRig | null = null;
  private ghosts: ArrowRig[] = [];
  private bowGroup: THREE.Group | null = null;
  private stringLine: THREE.Line | null = null;
  private stringGeo: THREE.BufferGeometry | null = null;
  private restBlade: THREE.Mesh | null = null;
  private plunger: THREE.Mesh | null = null;
  private paperMesh: THREE.Mesh | null = null;
  private paperMat: THREE.MeshStandardMaterial | null = null;
  private texClean: THREE.CanvasTexture | null = null;
  private texTorn: THREE.CanvasTexture | null = null;
  private contacts: ContactEvent[] = [];
  private markers: THREE.Mesh[] = [];
  private grid: THREE.GridHelper;

  time = 0;
  showTrails = true;
  showTopSide = true;
  viewMode: 'follow' | 'close' = 'follow';

  constructor(container: HTMLElement, labels: LabelEls = {}) {
    this.container = container;
    this.labels = labels;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(container.clientWidth || 800, container.clientHeight || 560, false);
    this.renderer.domElement.className = 'stage-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color('#0a0e15');
    this.scene.fog = new THREE.Fog('#0a0e15', 7, 16);

    const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x3a2c1c, 1.05);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff0d8, 2.4);
    key.position.set(1.6, 2.6, 2.2);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x59c8ff, 0.7);
    rim.position.set(-2.4, 1.4, -2.2);
    this.scene.add(rim);

    this.grid = new THREE.GridHelper(8, 40, 0x2c3c55, 0x1b2536);
    this.grid.position.y = -0.92;
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.55;
    this.scene.add(this.grid);

    this.topCam.up.set(0, 0, 1);
    this.topCam.position.set(0, 4, 0.001);
    this.sideCam.position.set(0, 0.05, -4);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();

    const loop = () => {
      if (this.disposed) return;
      this.updateDynamic();
      this.renderViews();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  setConfig(cfg: ShotConfig): void {
    const sig = `${cfg.bowType}|${cfg.arrowLengthIn}|${cfg.vaneCount}|${cfg.paperDistanceM}|${cfg.shaftDiameterMm}|${cfg.vaneHeightMm}`;
    this.cfg = cfg;
    this.showTrails = true;
    if (sig !== this.signature) {
      this.signature = sig;
      this.rebuild(cfg);
    }
    this.refreshTear(cfg);
    this.contacts = detectContacts(cfg);
    this.rebuildMarkers();
  }

  setTime(t: number): void {
    this.time = t;
  }

  // ---------------- 构建 ----------------
  private clearGroup(g: THREE.Group | null): void {
    if (!g) return;
    this.scene.remove(g);
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }

  private rebuild(cfg: ShotConfig): void {
    this.clearGroup(this.bowGroup);
    if (this.mainRig) this.scene.remove(this.mainRig.group);
    this.ghosts.forEach((g) => this.scene.remove(g.group));
    this.ghosts = [];
    this.markers.forEach((m) => this.scene.remove(m));
    this.markers = [];

    this.bowGroup = this.buildBow(cfg);
    this.scene.add(this.bowGroup);

    this.mainRig = this.buildArrowRig(cfg, false);
    this.scene.add(this.mainRig.group);
    for (let i = 1; i <= 7; i++) {
      const ghost = this.buildArrowRig(cfg, true);
      ghost.group.visible = false;
      this.ghosts.push(ghost);
      this.scene.add(ghost.group);
    }
    this.buildPaper(cfg);
  }

  private arrowUniforms(): Record<string, THREE.IUniform> {
    return {
      uModeTex: { value: getModeTexture() },
      uQy1: { value: 0 },
      uQz1: { value: 0 },
      uQy2: { value: 0 },
      uQz2: { value: 0 },
    };
  }

  private buildArrowRig(cfg: ShotConfig, ghost: boolean): ArrowRig {
    const Lm = cfg.arrowLengthIn * 0.0254;
    const r = cfg.shaftDiameterMm * 0.001 * 0.5;
    const uniforms = this.arrowUniforms();
    const group = new THREE.Group();
    const yawG = new THREE.Group();
    const pitchG = new THREE.Group();
    const rollG = new THREE.Group();
    group.add(yawG);
    yawG.add(pitchG);
    pitchG.add(rollG);

    const shaftGeo = new THREE.CylinderGeometry(r, r, Lm, 20, 96, false);
    shaftGeo.rotateZ(-Math.PI / 2);
    const shaftMat = ghost
      ? new THREE.MeshBasicMaterial({ color: 0x9fe9ff, transparent: true, opacity: 0.12, depthWrite: false })
      : new THREE.MeshStandardMaterial({ color: 0x232a36, metalness: 0.55, roughness: 0.32 });
    if (!ghost) injectBend(shaftMat, uniforms, Lm);
    else {
      // ghost 也要弯：用同一注入
      injectBend(shaftMat, uniforms, Lm);
      shaftMat.transparent = true;
    }
    const shaft = new THREE.Mesh(shaftGeo, shaftMat);
    rollG.add(shaft);

    if (!ghost) {
      const pointGeo = new THREE.ConeGeometry(r * 2.1, 0.052, 18);
      pointGeo.rotateZ(-Math.PI / 2);
      const point = new THREE.Mesh(
        pointGeo,
        new THREE.MeshStandardMaterial({ color: 0x9aa7bd, metalness: 0.9, roughness: 0.25 }),
      );
      point.position.x = Lm / 2 + 0.02;
      rollG.add(point);

      const nock = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 1.5, r * 1.5, 0.018, 12),
        new THREE.MeshStandardMaterial({ color: 0xd8e2f2, roughness: 0.5 }),
      );
      nock.geometry.rotateZ(-Math.PI / 2);
      nock.position.x = -Lm / 2 - 0.006;
      rollG.add(nock);
    }

    // 箭羽
    const vaneLenM = cfg.vaneLengthIn * 0.0254;
    const hM = cfg.vaneHeightMm * 0.001;
    const beta = (cfg.fletchOffsetDeg * Math.PI) / 180;
    for (let k = 0; k < cfg.vaneCount; k++) {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(vaneLenM * 0.18, hM);
      shape.lineTo(vaneLenM * 0.82, hM * 0.72);
      shape.lineTo(vaneLenM, 0);
      shape.closePath();
      const vaneGeo = new THREE.ShapeGeometry(shape);
      const isCock = k === 0;
      const vaneMat = ghost
        ? new THREE.MeshBasicMaterial({ color: 0x9fe9ff, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false })
        : new THREE.MeshStandardMaterial({
            color: isCock ? 0xf2b441 : 0xe6edf9,
            side: THREE.DoubleSide,
            roughness: 0.55,
            metalness: 0.05,
          });
      const pivot = new THREE.Group();
      pivot.rotation.x = (k * Math.PI * 2) / cfg.vaneCount;
      const vane = new THREE.Mesh(vaneGeo, vaneMat);
      vane.position.x = -Lm / 2 + 0.022;
      vane.rotation.y = beta * (k % 2 === 0 ? 1 : 0.6);
      pivot.add(vane);
      rollG.add(pivot);
    }

    const setPose = (t: number) => {
      if (!this.cfg) return;
      const pose = poseAt(this.cfg, t);
      group.position.set(pose.xNock + Lm / 2, pose.y, pose.z);
      yawG.rotation.y = pose.yaw;
      pitchG.rotation.z = pose.pitch;
      rollG.rotation.x = pose.roll;
      uniforms.uQy1.value = pose.qy1;
      uniforms.uQz1.value = pose.qz1;
      uniforms.uQy2.value = pose.qy2;
      uniforms.uQz2.value = pose.qz2;
    };
    const setOpacity = (a: number) => {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        const mat = m.material as THREE.MeshBasicMaterial;
        if (mat && 'opacity' in mat) {
          mat.transparent = true;
          mat.opacity = a;
        }
      });
    };
    return { group, uniforms, setPose, setOpacity };
  }

  private buildBow(cfg: ShotConfig): THREE.Group {
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x2b3547, metalness: 0.8, roughness: 0.34 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a2130, metalness: 0.4, roughness: 0.6 });
    const limbMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, metalness: 0.2, roughness: 0.55 });
    const camMat = new THREE.MeshStandardMaterial({ color: 0x8b97ad, metalness: 0.95, roughness: 0.22 });

    // 弓把
    const riser = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.6, 0.055), metal);
    riser.position.set(0, 0, 0);
    g.add(riser);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.16, 0.075), dark);
    grip.position.set(0.01, -0.05, 0);
    g.add(grip);
    // 弓窗强调框（-z 侧）
    const window = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.02), new THREE.MeshStandardMaterial({ color: 0x11161f }));
    window.position.set(0.06, 0.06, -0.035);
    g.add(window);

    const tipYs: number[] = [];
    if (cfg.bowType === 'recurve') {
      for (const s of [1, -1]) {
        const pts = [
          new THREE.Vector3(0, s * 0.28, 0),
          new THREE.Vector3(0.015, s * 0.44, 0),
          new THREE.Vector3(0.05, s * 0.6, 0),
          new THREE.Vector3(0.13, s * 0.76, 0),
        ];
        const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, 0.021, 10), limbMat);
        g.add(tube);
        tipYs.push(s * 0.76);
      }
    } else {
      for (const s of [1, -1]) {
        // 复合分岔弓片
        for (const z of [-0.035, 0.035]) {
          const limb = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.34, 0.018), limbMat);
          limb.position.set(0.02, s * 0.42, z);
          limb.rotation.z = s * 0.08;
          g.add(limb);
        }
        const cam = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.012, 12, 30), camMat);
        cam.position.set(0.05, s * 0.6, 0);
        g.add(cam);
        tipYs.push(s * 0.6);
      }
      // 缆绳
      const cableGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0.05, 0.6, 0.03),
        new THREE.Vector3(0.05, -0.6, 0.03),
      ]);
      g.add(new THREE.Line(cableGeo, new THREE.LineBasicMaterial({ color: 0x8893a8 })));
    }

    // 弦（三段动态更新）
    const stringGeo = new THREE.BufferGeometry();
    stringGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    const stringLine = new THREE.Line(stringGeo, new THREE.LineBasicMaterial({ color: 0xe9e2cf }));
    g.add(stringLine);
    this.stringLine = stringLine;
    this.stringGeo = stringGeo;
    (g as unknown as { userData: unknown }).userData = { tipTopY: Math.max(...tipYs), tipBotY: Math.min(...tipYs) };

    // 箭台刀片 + 弹性柱
    this.restBlade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.006, 0.018), new THREE.MeshStandardMaterial({ color: 0xf2b441, metalness: 0.6, roughness: 0.3 }));
    this.restBlade.position.set(0.02, -cfg.shaftDiameterMm * 0.001 * 0.5 - 0.004, cfg.restCenterMm * 0.001);
    g.add(this.restBlade);
    this.plunger = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 14), new THREE.MeshStandardMaterial({ color: 0x46d3e8, metalness: 0.7, roughness: 0.3 }));
    this.plunger.rotation.x = Math.PI / 2;
    this.plunger.position.set(0.02, 0, cfg.restCenterMm * 0.001 + 0.02);
    g.add(this.plunger);

    return g;
  }

  private makePaperTexture(torn: boolean): THREE.CanvasTexture {
    const S = 512;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d')!;
    const bg = ctx.createLinearGradient(0, 0, S, S);
    bg.addColorStop(0, '#f4efdd');
    bg.addColorStop(1, '#e4dac0');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, S, S);
    // 纸纹
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(120,100,70,${Math.random() * 0.05})`;
      ctx.fillRect(Math.random() * S, Math.random() * S, 2, 1);
    }
    if (torn && this.cfg) {
      const tear = computeTear(this.cfg);
      drawPaperTear(ctx, tear, S / 2, S / 2, S / 600);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  private buildPaper(cfg: ShotConfig): void {
    if (this.paperMesh) {
      this.scene.remove(this.paperMesh);
      this.paperMesh.geometry.dispose();
      this.paperMat?.dispose();
    }
    this.texClean?.dispose();
    this.texTorn?.dispose();
    this.texClean = this.makePaperTexture(false);
    this.texTorn = this.makePaperTexture(true);
    this.paperMat = new THREE.MeshStandardMaterial({ map: this.texClean, side: THREE.DoubleSide, roughness: 0.92 });
    const size = 0.62;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), this.paperMat);
    mesh.position.set(cfg.paperDistanceM, 0, 0);
    mesh.rotation.y = Math.PI / 2;
    mesh.scale.x = -1; // 让画布右侧对应世界 +z（射手右侧）
    this.paperMesh = mesh;
    this.scene.add(mesh);

    // 纸框
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x4a3b28, roughness: 0.8 });
    const t = 0.03;
    const frame = new THREE.Group();
    const mkBar = (w: number, h: number, y: number) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(t, h, w), frameMat);
      b.position.set(cfg.paperDistanceM, y, 0);
      frame.add(b);
    };
    mkBar(size + 0.08, t, size / 2 + 0.02);
    mkBar(size + 0.08, t, -size / 2 - 0.02);
    for (const z of [-size / 2 - 0.02, size / 2 + 0.02]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(t, size + 0.12, t), frameMat);
      b.position.set(cfg.paperDistanceM, 0, z);
      frame.add(b);
    }
    this.scene.add(frame);
  }

  private refreshTear(cfg: ShotConfig): void {
    // 参数变化后重建撕裂纹理
    this.texTorn?.dispose();
    this.texTorn = this.makePaperTexture(true);
    if (this.time >= paperTimeS(cfg) && this.paperMat) this.paperMat.map = this.texTorn;
    this.paperMat!.needsUpdate = true;
  }

  private rebuildMarkers(): void {
    this.markers.forEach((m) => {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
    this.markers = [];
    for (const e of this.contacts) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.011, 14, 10),
        new THREE.MeshBasicMaterial({ color: 0xff3b3b, depthTest: false }),
      );
      m.renderOrder = 999;
      this.scene.add(m);
      this.markers.push(m);
      void e;
    }
  }

  // ---------------- 每帧更新 ----------------
  private updateDynamic(): void {
    if (!this.cfg || !this.mainRig) return;
    const cfg = this.cfg;
    this.mainRig.setPose(this.time);

    // 拖影：在相机曝光窗口内均匀采样若干历史时刻
    const expS = this.exposureS;
    this.ghosts.forEach((g, i) => {
      if (!this.showTrails) {
        g.group.visible = false;
        return;
      }
      const tt = this.time - ((i + 1) / this.ghosts.length) * expS;
      if (tt < 0) {
        g.group.visible = false;
        return;
      }
      g.group.visible = true;
      g.setPose(Math.max(0, tt));
      g.setOpacity?.(0.16 * (1 - i / this.ghosts.length));
    });

    // 弦
    if (this.stringGeo && this.bowGroup) {
      const pose = poseAt(cfg, this.time);
      const ud = this.bowGroup.userData as { tipTopY: number; tipBotY: number };
      const arr = this.stringGeo.attributes.position.array as Float32Array;
      const Tp = powerS(cfg);
      const braceX = -cfg.braceHeightIn * 0.0254;
      let midX: number;
      if (this.time < Tp) midX = pose.xNock;
      else {
        const dt = this.time - Tp;
        midX = braceX + 0.018 * Math.exp(-dt / 0.12) * Math.sin(2 * Math.PI * 55 * dt);
      }
      const midY = cfg.nockHeightMm * 0.001;
      arr[0] = -0.02; arr[1] = ud.tipTopY; arr[2] = 0;
      arr[3] = midX; arr[4] = midY; arr[5] = 0;
      arr[6] = -0.02; arr[7] = ud.tipBotY; arr[8] = 0;
      this.stringGeo.attributes.position.needsUpdate = true;
    }

    // 箭台/侧垫随参数
    if (this.restBlade) this.restBlade.position.z = cfg.restCenterMm * 0.001;
    if (this.plunger) this.plunger.position.z = cfg.restCenterMm * 0.001 + 0.02;

    // 纸靶过纸切换
    if (this.paperMat) {
      const crossed = this.time >= paperTimeS(cfg);
      const want = crossed ? this.texTorn : this.texClean;
      if (this.paperMat.map !== want) {
        this.paperMat.map = want;
        this.paperMat.needsUpdate = true;
      }
    }

    // 接触标记锚定到当前帧羽片
    this.contacts.forEach((e, i) => {
      const marker = this.markers[i];
      if (!marker) return;
      const p = vanePointWorld(cfg, poseAt(cfg, this.time), e.vaneIndex, e.alongVane, 0.85);
      marker.position.set(p.x, p.y, p.z);
      const near = Math.abs(this.time - e.tS) < 0.004;
      const s = near ? 1.7 + 0.5 * Math.sin(performance.now() / 90) : 1;
      marker.scale.setScalar(s);
    });

    // 相机跟随（纯 t 推导，拖轴不抖）
    const pose = poseAt(cfg, this.time);
    const focusX =
      this.viewMode === 'close'
        ? 0.05
        : THREE.MathUtils.clamp(pose.xTip - 0.32, -0.28, Math.max(-0.1, cfg.paperDistanceM - 0.35));
    this.persp.position.set(focusX + 0.34, 0.32, 1.42);
    this.persp.lookAt(focusX + 0.06, -0.04, 0);
    this.topCam.position.set(focusX, 4, 0.001);
    this.topCam.lookAt(focusX, 0, 0);
    this.sideCam.position.set(focusX, -0.02, -4);
    this.sideCam.lookAt(focusX, -0.02, 0);
  }

  private exposureS = 0.003;
  setExposure(ms: number): void {
    // 拖影采样总跨度：曝光时间，最短给 0.6ms 以便看见
    this.exposureS = Math.max(0.0006, ms / 1000);
  }

  // ---------------- 视口 ----------------
  private computeRects(): { main: Rect; top: Rect; side: Rect } {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const narrow = w < 720;
    if (!this.showTopSide) {
      const full: Rect = { css: { left: 0, top: 0, width: w, height: h }, gl: { x: 0, y: 0, w, h } };
      return { main: full, top: full, side: full };
    }
    if (!narrow) {
      const mw = Math.round(w * 0.68);
      const rw = w - mw;
      return {
        main: { css: { left: 0, top: 0, width: mw, height: h }, gl: { x: 0, y: 0, w: mw, h } },
        top: { css: { left: mw, top: 0, width: rw, height: h / 2 }, gl: { x: mw, y: h / 2, w: rw, h: h / 2 } },
        side: { css: { left: mw, top: h / 2, width: rw, height: h / 2 }, gl: { x: mw, y: 0, w: rw, h: h / 2 } },
      };
    }
    const mh = Math.round(h * 0.62);
    const bh = h - mh;
    return {
      main: { css: { left: 0, top: 0, width: w, height: mh }, gl: { x: 0, y: bh, w, h: mh } },
      top: { css: { left: 0, top: mh, width: w / 2, height: bh }, gl: { x: 0, y: 0, w: w / 2, h: bh } },
      side: { css: { left: w / 2, top: mh, width: w / 2, height: bh }, gl: { x: w / 2, y: 0, w: w / 2, h: bh } },
    };
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
  }

  private applyCameraAspect(cam: THREE.OrthographicCamera | THREE.PerspectiveCamera, rect: Rect): void {
    const aspect = rect.gl.w / Math.max(1, rect.gl.h);
    if (cam instanceof THREE.PerspectiveCamera) {
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    } else {
      const halfH = cam === this.topCam ? 0.42 : 0.82;
      cam.top = halfH;
      cam.bottom = -halfH;
      cam.left = -halfH * aspect;
      cam.right = halfH * aspect;
      cam.updateProjectionMatrix();
    }
  }

  private renderViews(): void {
    const rects = this.computeRects();
    const r = this.renderer;
    r.setScissorTest(true);
    const draw = (cam: THREE.Camera, rect: Rect) => {
      this.applyCameraAspect(cam as never, rect);
      r.setViewport(rect.gl.x, rect.gl.y, rect.gl.w, rect.gl.h);
      r.setScissor(rect.gl.x, rect.gl.y, rect.gl.w, rect.gl.h);
      r.render(this.scene, cam);
    };
    draw(this.persp, rects.main);
    if (this.showTopSide) {
      draw(this.topCam, rects.top);
      draw(this.sideCam, rects.side);
    }
    this.positionLabel(this.labels.main, rects.main.css, '透视');
    this.positionLabel(this.labels.top, rects.top.css, '顶视');
    this.positionLabel(this.labels.side, rects.side.css, '侧视');
  }

  private positionLabel(el: HTMLElement | undefined, css: Rect['css'], text: string): void {
    if (!el) return;
    if (el.textContent !== text) el.textContent = text;
    el.style.display = this.showTopSide || text === '透视' ? '' : 'none';
    el.style.left = `${css.left + 10}px`;
    el.style.top = `${css.top + 10}px`;
  }

  /** 偏软侧方向（供页面显示） */
  softSign(): number {
    return this.cfg ? softSideSign(this.cfg.handedness) : 1;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.texClean?.dispose();
    this.texTorn?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

// 让 bendAtS 被引用（接触定位在 core 已用，这里保留扩展点）
void bendAtS;
