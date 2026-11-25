// ============================================================
// 纸靶调弓推演系统 —— 全局领域类型
// 所有物理量在 core 层同时保留英制录入单位与 SI 换算，
// 页面层只做录入/展示，推演全部走 physics/shot 纯函数。
// ============================================================

export type BowType = 'recurve' | 'compound';
export type Handedness = 'RH' | 'LH';

/** 弓档案：反曲 / 复合统一结构，差异字段按 bowType 使用 */
export interface BowProfile {
  id: string;
  kind: 'bow';
  createdAt: number;
  name: string;
  customerName?: string;
  brand?: string;
  bowType: BowType;

  /** 峰值/标称拉力 lb */
  drawWeightLb: number;
  /** 标称拉力对应的拉距 in（通常 28） */
  ratedDrawLengthIn: number;
  /** 客户实际拉距 in */
  drawLengthIn: number;
  /** 弓长 AMO in */
  bowLengthIn: number;
  /** 弦距（握把最深点到弦）in */
  braceHeightIn: number;

  handedness: Handedness;

  // —— 反曲专属 ——
  limbModel?: string;
  limbLengthIn?: number;
  /** 弓片标称磅数（片上写字的磅数） */
  limbMarkWeightLb?: number;
  /** 弓片等级，影响拉力曲线硬度 */
  limbGrade?: 'short' | 'medium' | 'long';

  // —— 复合专属 ——
  camModel?: string;
  /** 让力比（省力比）%，如 80 表示峰值后只剩 20% 持弓重量 */
  letOffPct?: number;
  /** 轮轴距 in */
  axleToAxleIn?: number;

  // —— 当前调校参数 ——
  /** 搭箭点相对箭台水平线高度 mm，正=偏高 */
  nockHeightMm: number;
  /** 箭台中心距：相对弓窗几何中心 mm，射手视角 +向右 */
  restCenterMm: number;
  /** 弹性柱（plunger）压力刻度 0-100 */
  plungerPressure: number;
  restType?: string;

  notes?: string;
}

/** 箭档案 */
export interface ArrowProfile {
  id: string;
  kind: 'arrow';
  createdAt: number;
  name: string;
  customerName?: string;

  shaftModel: string;
  /** 静态 spine（ATA 千分之一英寸挠度值，越大越软） */
  staticSpine: number;
  /** 箭杆长度 in（箭尾槽底到杆前端） */
  lengthIn: number;
  /** 箭杆每英寸格令重量 */
  shaftGpi: number;
  shaftDiameterIn?: number;

  /** 箭头重量 gr */
  pointWeightGr: number;
  /** 箭座/插销重量 gr */
  insertWeightGr: number;
  /** 箭尾重量 gr */
  nockWeightGr: number;

  fletchCount: 3 | 4;
  /** 每片箭羽重量 gr */
  vaneWeightGrEach: number;
  vaneLengthIn: number;
  vaneHeightMm: number;
  /** 粘羽偏置角 deg（相对杆母线，决定旋转扭矩） */
  fletchOffsetDeg: number;
  /** 螺旋羽角度 deg（与偏置叠加） */
  helicalDeg: number;

  /** 箭羽缠绕/热缩膜 gr */
  wrapWeightGr: number;

  notes?: string;
}

/** 配箭计算结果 */
export interface ArrowStats {
  shaftWeightGr: number;
  fletchWeightGr: number;
  totalWeightGr: number;
  totalMassKg: number;
  /** 重心距箭尾槽底 in */
  balancePointIn: number;
  focPct: number;
  /** 由静态 spine 反推的抗弯刚度 N·m² */
  eiNm2: number;
  /** 梁模型一阶频率 Hz（自由-自由边界，等效线密度=总重/全长） */
  beamF1Hz: number;
  beamF2Hz: number;
  /** 动态 spine 等效值（越大越软） */
  dynamicSpine: number;
  /** 弓在当前拉距下的推荐 spine */
  bowRequiredSpine: number;
  /** dynamicSpine / required，>1 偏软 */
  spineRatio: number;
  verdict: 'stiff' | 'matching' | 'soft';
  /** 估算初速 m/s */
  launchSpeedMps: number;
  /** 弓的储能 J */
  storedEnergyJ: number;
}

/** 一次推演的完整输入（弓+箭+调校的可序列化快照） */
export interface ShotConfig {
  seed: number;
  bowType: BowType;
  handedness: Handedness;
  releaseStyle: 'fingers' | 'caliper';

  drawWeightLb: number;
  drawLengthIn: number;
  braceHeightIn: number;
  letOffPct: number;

  arrowLengthIn: number;
  totalWeightGr: number;
  eiNm2: number;
  f1Hz: number;
  f2Hz: number;
  v0Mps: number;

  // 调校量（mm / 刻度）
  nockHeightMm: number;
  idealNockMm: number;
  restCenterMm: number;
  idealRestMm: number;
  plungerPressure: number;
  idealPlunger: number;

  /** 动态软硬比 spineRatio */
  spineRatio: number;
  fletchOffsetDeg: number;
  vaneCount: number;
  vaneLengthIn: number;
  vaneHeightMm: number;
  shaftDiameterMm: number;

  /** 射手稳定性/新手散乱度 0..1，影响杂乱撕痕与弹着散布 */
  chaos: number;

  /** 纸靶距弓 m */
  paperDistanceM: number;
}

/** 箭在某一真实时刻的采样状态（全部为 t 的纯函数） */
export interface ArrowPose {
  t: number;
  /** 箭头沿 x 方向世界坐标 m（弓/箭台附近为原点） */
  xTip: number;
  /** 箭尾坐标 */
  xNock: number;
  y: number;
  z: number;
  speed: number;
  /** 刚体俯仰 rad（x-y 平面，+ 箭头朝上） */
  pitch: number;
  /** 刚体偏航 rad（x-z 平面，+ 箭头朝 +z） */
  yaw: number;
  /** 滚转角 rad */
  roll: number;
  /** 一阶/二阶振型系数（m），y=上下，z=左右 */
  qy1: number;
  qz1: number;
  qy2: number;
  qz2: number;
}

export interface ContactEvent {
  tS: number;
  vaneIndex: number;
  /** 距箭尾的杆坐标 m */
  sFromNockM: number;
  /** 沿羽片长度 0..1 的位置 */
  alongVane: number;
  target: 'rest_blade' | 'riser_window' | 'plunger';
  x: number;
  y: number;
  z: number;
  severityMm: number;
}

export interface FlapSpec {
  /** 裂口方向角 rad（纸面坐标） */
  angle: number;
  /** 根部在主裂口上的位置 0..1 */
  at: number;
  lengthMm: number;
  widthMm: number;
  /** 翻起角度 rad */
  curl: number;
  side: -1 | 1;
  shade: number;
}

/** 程序化纸靶裂口描述（同一 seed 永远生成同一张裂口） */
export interface TearReport {
  seed: number;
  /** 主撕痕方向（箭头孔→箭羽撕裂中心）单位向量，纸面坐标 h 向右 v 向上 */
  dirH: number;
  dirV: number;
  angleDeg: number;
  lengthMm: number;
  widthMm: number;
  /** 过纸时攻角 */
  yawDeg: number;
  pitchDeg: number;
  /** 过纸时箭尾相对箭头孔偏移 mm */
  tailHMm: number;
  tailVMm: number;
  raggedness: number;
  flaps: FlapSpec[];
  /** 每片羽的小撕痕 */
  vaneTears: { angleDeg: number; lengthMm: number; widthMm: number }[];
  /** 判定方向 */
  vertical: 'high' | 'low' | 'none';
  horizontal: 'soft' | 'stiff' | 'center';
  /** 软侧方向系数（已含左右手），+1 表示纸面 +h 为偏软侧 */
  softSideSign: 1 | -1;
  /** 综合“脏乱度”0..1（新手离散抖动） */
  chaos: number;
}

/** 纸靶照片标注：点箭头孔与箭羽撕痕 */
export interface PhotoMarks {
  pointPx: { x: number; y: number } | null;
  tearPx: { x: number; y: number } | null;
  extraTearsPx: { x: number; y: number }[];
  /** 照片坐标系是否为射手侧视角（否则水平翻转） */
  shooterView: boolean;
  /** 纸张可视宽度 mm（用于像素→mm） */
  paperWidthMm: number;
  imageWidthPx: number;
  /** 可选：标定好的 mm/px（合成样片自带，透视后取均值） */
  mmPerPx?: number | null;
}

export interface PhotoRecord {
  id: string;
  name: string;
  kind: 'sample' | 'import';
  createdAt: number;
  dataUrl: string;
  width: number;
  height: number;
  /** 合成样片的真实标注，便于一键填入 */
  groundTruth?: PhotoMarks;
  tags?: string[];
}

/** 一条调弓建议 */
export interface Advice {
  id: string;
  target: 'nockPoint' | 'restCenter' | 'plunger' | 'pointWeight' | 'spine' | 'form';
  title: string;
  direction: string;
  /** 建议调整量的自然单位文本，如 “+0.5 mm” */
  deltaText: string;
  /** 标准化改动量（微调步数），用于从小到大排序 */
  changeAmount: number;
  confidence: number;
  reason: string;
  /** 应用到调校参数的补丁 */
  patch?: Partial<TuneParams>;
}

/** 可逐步调整的参数 */
export interface TuneParams {
  nockHeightMm: number;
  restCenterMm: number;
  plungerPressure: number;
  pointWeightGr: number;
}

/** 调试会话中的一步 */
export interface TuneStep {
  id: string;
  at: number;
  title: string;
  note?: string;
  params: TuneParams;
  /** 本步使用的箭头重量（可能改了箭头） */
  arrowId: string;
  tear: TearReport;
  /** 本步检测到的擦箭羽事件数 */
  contactCount: number;
  advices: Advice[];
  /** 关联实射照片 */
  photoId?: string;
  /** 本步相对上一步做了什么 */
  changes: string[];
}

export interface TuneSession {
  id: string;
  customerName: string;
  bowId: string;
  arrowId: string;
  createdAt: number;
  updatedAt: number;
  steps: TuneStep[];
}

export interface AppSettings {
  id: 'app';
  handedness: Handedness;
  paperDistanceM: number;
  cameraFps: number;
  exposureMs: number;
  slowMo: number;
  showTrails: boolean;
  showTopSide: boolean;
  reducedMotion: boolean;
}

/** 远距分组弹着 */
export interface ImpactGroup {
  distanceM: 18 | 30;
  kind: 'bare' | 'fletched';
  impacts: { hMm: number; vMm: number }[];
  centerHMm: number;
  centerVMm: number;
  meanRadiusMm: number;
  groupSizeMm: number;
}
