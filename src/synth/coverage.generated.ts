/**
 * GENERATED FILE — 手で編集しないこと。
 * `pnpm measure:coverage` で再生成する。
 *
 * Generator ごとの画面占有度の実測値。意味と測り方は ./coverage.ts と
 * ./gl/coverageMeasure.ts を参照。要点だけ:
 *
 * - 256x256 の WebGL2 オフスクリーンで実測
 * - 時刻 0 / 1.7 / 4.3 / 9.1 秒の 4 サンプルを平均
 * - パラメータは seed "coverage-v1" から決定的に引いた
 *   8 セット。その分布が p10 / p50 / p90
 * - source は material 無しの単体（fragColor = vec4(v,v,v,v)）で測る
 * - source 以外は基準 source "grid" の上で測る。基準は
 *   全コンテキストで同一パラメータなので、"grid" のエントリとの
 *   差がその operator の寄与になる
 * - solidFraction はアルファ > 0.5 のピクセル比率
 */
import type { CoverageTable } from './coverage';

export const GENERATOR_COVERAGE: CoverageTable = {
  asanoha: {
    meanAlpha: { p10: 0.2943, p50: 0.4074, p90: 0.4842 },
    solidFraction: { p10: 0.2946, p50: 0.4356, p90: 0.5186 },
  },
  asphaltIridescence: {
    meanAlpha: { p10: 0.4952, p50: 0.7528, p90: 0.8411 },
    solidFraction: { p10: 0.4761, p50: 0.7989, p90: 0.9066 },
  },
  barcode: {
    meanAlpha: { p10: 0.3666, p50: 0.4538, p90: 0.5439 },
    solidFraction: { p10: 0.3696, p50: 0.4502, p90: 0.5665 },
  },
  bathroomGlaze: {
    meanAlpha: { p10: 0.4728, p50: 0.7289, p90: 0.8376 },
    solidFraction: { p10: 0.4873, p50: 0.7941, p90: 0.9045 },
  },
  beatMoire: {
    meanAlpha: { p10: 0.4496, p50: 0.712, p90: 0.8283 },
    solidFraction: { p10: 0.4468, p50: 0.7656, p90: 0.9026 },
  },
  bellowsHose: {
    meanAlpha: { p10: 0.0599, p50: 0.0638, p90: 0.0721 },
    solidFraction: { p10: 0.0532, p50: 0.0573, p90: 0.0675 },
  },
  blueprint: {
    meanAlpha: { p10: 0.6084, p50: 0.8342, p90: 0.8942 },
    solidFraction: { p10: 0.5488, p50: 0.8991, p90: 0.9566 },
  },
  brakeLightRain: {
    meanAlpha: { p10: 0.2619, p50: 0.6352, p90: 0.8096 },
    solidFraction: { p10: 0.2293, p50: 0.6984, p90: 0.9008 },
  },
  branch: {
    meanAlpha: { p10: 0.4747, p50: 0.9826, p90: 1.0 },
    solidFraction: { p10: 0.4737, p50: 0.9827, p90: 1.0 },
  },
  busJacquard: {
    meanAlpha: { p10: 0.231, p50: 0.3221, p90: 0.4416 },
    solidFraction: { p10: 0.2273, p50: 0.3242, p90: 0.464 },
  },
  busPolarization: {
    meanAlpha: { p10: 0.3037, p50: 0.698, p90: 0.9211 },
    solidFraction: { p10: 0.2622, p50: 0.724, p90: 0.9289 },
  },
  cassetteWindow: {
    meanAlpha: { p10: 0.0659, p50: 0.0963, p90: 0.1421 },
    solidFraction: { p10: 0.0606, p50: 0.0899, p90: 0.1339 },
  },
  cdDiffraction: {
    meanAlpha: { p10: 0.4056, p50: 0.7661, p90: 0.9519 },
    solidFraction: { p10: 0.3464, p50: 0.8111, p90: 0.9552 },
  },
  cells: {
    meanAlpha: { p10: 0.1894, p50: 0.2265, p90: 0.2702 },
    solidFraction: { p10: 0.0789, p50: 0.0979, p90: 0.1677 },
  },
  chainlink: {
    meanAlpha: { p10: 0.4284, p50: 0.9046, p90: 0.9995 },
    solidFraction: { p10: 0.4294, p50: 0.9196, p90: 1.0 },
  },
  cheapLed: {
    meanAlpha: { p10: 0.0662, p50: 0.1133, p90: 0.1636 },
    solidFraction: { p10: 0.0648, p50: 0.1155, p90: 0.1671 },
  },
  checker: {
    meanAlpha: { p10: 0.4999, p50: 0.5, p90: 0.5 },
    solidFraction: { p10: 0.5, p50: 0.5, p90: 0.5 },
  },
  concentric: {
    meanAlpha: { p10: 0.6197, p50: 0.9996, p90: 1.0 },
    solidFraction: { p10: 0.6214, p50: 0.9995, p90: 1.0 },
  },
  coneField: {
    meanAlpha: { p10: 0.5147, p50: 0.7801, p90: 0.8874 },
    solidFraction: { p10: 0.5303, p50: 0.8082, p90: 0.9169 },
  },
  contour: {
    meanAlpha: { p10: 0.105, p50: 0.1666, p90: 0.3793 },
    solidFraction: { p10: 0.1049, p50: 0.1664, p90: 0.3897 },
  },
  corruptSave: {
    meanAlpha: { p10: 0.4891, p50: 0.7809, p90: 0.8967 },
    solidFraction: { p10: 0.4913, p50: 0.8084, p90: 0.9149 },
  },
  crossingParallax: {
    meanAlpha: { p10: 0.4899, p50: 0.7806, p90: 0.8962 },
    solidFraction: { p10: 0.4905, p50: 0.8082, p90: 0.9154 },
  },
  crt: {
    meanAlpha: { p10: 0.3545, p50: 0.5005, p90: 0.6476 },
    solidFraction: { p10: 0.3451, p50: 0.5309, p90: 0.7632 },
  },
  dropout: {
    meanAlpha: { p10: 0.1014, p50: 0.307, p90: 0.7541 },
    solidFraction: { p10: 0.1051, p50: 0.3127, p90: 0.7731 },
  },
  fanGuard: {
    meanAlpha: { p10: 0.1306, p50: 0.2134, p90: 0.288 },
    solidFraction: { p10: 0.1308, p50: 0.2141, p90: 0.2905 },
  },
  flow: {
    meanAlpha: { p10: 0.4955, p50: 0.7784, p90: 0.8843 },
    solidFraction: { p10: 0.4937, p50: 0.8061, p90: 0.916 },
  },
  fluorescent: {
    meanAlpha: { p10: 0.3227, p50: 0.6974, p90: 0.8904 },
    solidFraction: { p10: 0.2922, p50: 0.7635, p90: 0.929 },
  },
  flyoverBeams: {
    meanAlpha: { p10: 0.0212, p50: 0.0287, p90: 0.0604 },
    solidFraction: { p10: 0.0232, p50: 0.0289, p90: 0.0635 },
  },
  freezerCyan: {
    meanAlpha: { p10: 0.3215, p50: 0.7173, p90: 0.9273 },
    solidFraction: { p10: 0.2636, p50: 0.7449, p90: 0.934 },
  },
  gamma: {
    meanAlpha: { p10: 0.421, p50: 0.6652, p90: 0.8934 },
    solidFraction: { p10: 0.4276, p50: 0.6583, p90: 0.9113 },
  },
  gate: {
    meanAlpha: { p10: 0.0, p50: 0.3884, p90: 0.6938 },
    solidFraction: { p10: 0.0, p50: 0.402, p90: 0.7151 },
  },
  goldfoil: {
    meanAlpha: { p10: 0.4326, p50: 0.6846, p90: 0.7917 },
    solidFraction: { p10: 0.4535, p50: 0.7777, p90: 0.9019 },
  },
  grain: {
    meanAlpha: { p10: 0.4777, p50: 0.7595, p90: 0.8685 },
    solidFraction: { p10: 0.4817, p50: 0.8018, p90: 0.9118 },
  },
  grid: {
    meanAlpha: { p10: 0.488, p50: 0.7809, p90: 0.8967 },
    solidFraction: { p10: 0.491, p50: 0.8086, p90: 0.9146 },
  },
  grille: {
    meanAlpha: { p10: 0.3158, p50: 0.5333, p90: 0.8033 },
    solidFraction: { p10: 0.32, p50: 0.5383, p90: 0.8064 },
  },
  halftone: {
    meanAlpha: { p10: 0.4724, p50: 0.7449, p90: 0.858 },
    solidFraction: { p10: 0.4746, p50: 0.7823, p90: 0.9008 },
  },
  harborBackwash: {
    meanAlpha: { p10: 0.49, p50: 0.7809, p90: 0.8951 },
    solidFraction: { p10: 0.4863, p50: 0.8068, p90: 0.9163 },
  },
  hexGrid: {
    meanAlpha: { p10: 0.2708, p50: 0.7542, p90: 0.9607 },
    solidFraction: { p10: 0.2695, p50: 0.7609, p90: 0.9644 },
  },
  hillClimb: {
    meanAlpha: { p10: 0.4885, p50: 0.7817, p90: 0.8988 },
    solidFraction: { p10: 0.484, p50: 0.8087, p90: 0.9173 },
  },
  humidGalvanized: {
    meanAlpha: { p10: 0.3038, p50: 0.7099, p90: 0.9255 },
    solidFraction: { p10: 0.2671, p50: 0.7288, p90: 0.9331 },
  },
  humidityLens: {
    meanAlpha: { p10: 0.4968, p50: 0.7826, p90: 0.8946 },
    solidFraction: { p10: 0.498, p50: 0.8103, p90: 0.9167 },
  },
  ink: {
    meanAlpha: { p10: 0.2099, p50: 0.6309, p90: 0.9324 },
    solidFraction: { p10: 0.0, p50: 0.6111, p90: 0.9381 },
  },
  interlaceComb: {
    meanAlpha: { p10: 0.5172, p50: 0.781, p90: 0.8827 },
    solidFraction: { p10: 0.5282, p50: 0.8166, p90: 0.9163 },
  },
  invert: {
    meanAlpha: { p10: 0.2751, p50: 0.5678, p90: 0.7649 },
    solidFraction: { p10: 0.1507, p50: 0.6346, p90: 0.8936 },
  },
  kaleido: {
    meanAlpha: { p10: 0.5104, p50: 0.7736, p90: 0.8908 },
    solidFraction: { p10: 0.5129, p50: 0.8075, p90: 0.9155 },
  },
  karaokeLcd: {
    meanAlpha: { p10: 0.3504, p50: 0.733, p90: 0.9393 },
    solidFraction: { p10: 0.3041, p50: 0.7707, p90: 0.9445 },
  },
  kumiko: {
    meanAlpha: { p10: 0.0856, p50: 0.1286, p90: 0.2495 },
    solidFraction: { p10: 0.0738, p50: 0.1156, p90: 0.2723 },
  },
  macroblock: {
    meanAlpha: { p10: 0.4369, p50: 0.7997, p90: 0.9063 },
    solidFraction: { p10: 0.432, p50: 0.8145, p90: 0.9125 },
  },
  minidvFade: {
    meanAlpha: { p10: 0.4863, p50: 0.7495, p90: 0.8421 },
    solidFraction: { p10: 0.4888, p50: 0.8073, p90: 0.9146 },
  },
  mirror: {
    meanAlpha: { p10: 0.488, p50: 0.7809, p90: 0.8967 },
    solidFraction: { p10: 0.491, p50: 0.8086, p90: 0.9146 },
  },
  misprint: {
    meanAlpha: { p10: 0.4148, p50: 0.7474, p90: 0.9481 },
    solidFraction: { p10: 0.3428, p50: 0.791, p90: 0.953 },
  },
  mooringRope: {
    meanAlpha: { p10: 0.1013, p50: 0.1525, p90: 0.1842 },
    solidFraction: { p10: 0.1067, p50: 0.1837, p90: 0.2277 },
  },
  neon: {
    meanAlpha: { p10: 0.3389, p50: 0.7025, p90: 0.9287 },
    solidFraction: { p10: 0.2869, p50: 0.7486, p90: 0.9331 },
  },
  nicotineCeiling: {
    meanAlpha: { p10: 0.328, p50: 0.7213, p90: 0.9312 },
    solidFraction: { p10: 0.2906, p50: 0.7524, p90: 0.9378 },
  },
  nightMarketCurtain: {
    meanAlpha: { p10: 0.6281, p50: 0.6481, p90: 0.6745 },
    solidFraction: { p10: 0.9964, p50: 0.9994, p90: 1.0 },
  },
  noise: {
    meanAlpha: { p10: 0.5498, p50: 0.7826, p90: 0.8748 },
    solidFraction: { p10: 0.5806, p50: 0.8331, p90: 0.9279 },
  },
  outline: {
    meanAlpha: { p10: 0.009, p50: 0.1136, p90: 0.3209 },
    solidFraction: { p10: 0.009, p50: 0.1112, p90: 0.2992 },
  },
  paCarpet: {
    meanAlpha: { p10: 0.4412, p50: 0.7044, p90: 0.8093 },
    solidFraction: { p10: 0.4673, p50: 0.7847, p90: 0.9037 },
  },
  pcbMaze: {
    meanAlpha: { p10: 0.1222, p50: 0.1496, p90: 0.1902 },
    solidFraction: { p10: 0.1092, p50: 0.1339, p90: 0.1646 },
  },
  petals: {
    meanAlpha: { p10: 0.1342, p50: 0.5441, p90: 0.5926 },
    solidFraction: { p10: 0.1369, p50: 0.5796, p90: 0.6367 },
  },
  pixelate: {
    meanAlpha: { p10: 0.3723, p50: 0.7959, p90: 0.8776 },
    solidFraction: { p10: 0.3747, p50: 0.7946, p90: 0.8796 },
  },
  points: {
    meanAlpha: { p10: 0.1545, p50: 0.9384, p90: 0.9888 },
    solidFraction: { p10: 0.1229, p50: 0.953, p90: 0.9948 },
  },
  polar: {
    meanAlpha: { p10: 0.5988, p50: 0.7709, p90: 0.8748 },
    solidFraction: { p10: 0.664, p50: 0.8213, p90: 0.9227 },
  },
  polymeter: {
    meanAlpha: { p10: 0.4532, p50: 0.5098, p90: 0.5496 },
    solidFraction: { p10: 0.4626, p50: 0.5025, p90: 0.5559 },
  },
  posterize: {
    meanAlpha: { p10: 0.4848, p50: 0.7928, p90: 0.9022 },
    solidFraction: { p10: 0.5359, p50: 0.8221, p90: 0.9146 },
  },
  preSilenceBlack: {
    meanAlpha: { p10: 0.0694, p50: 0.1569, p90: 0.3915 },
    solidFraction: { p10: 0.0, p50: 0.0, p90: 0.2047 },
  },
  projectorBlackLift: {
    meanAlpha: { p10: 0.5069, p50: 0.7822, p90: 0.8918 },
    solidFraction: { p10: 0.4891, p50: 0.8087, p90: 0.9146 },
  },
  pulse: {
    meanAlpha: { p10: 0.4817, p50: 0.784, p90: 0.8942 },
    solidFraction: { p10: 0.4743, p50: 0.8076, p90: 0.9158 },
  },
  qilouShutter: {
    meanAlpha: { p10: 0.1978, p50: 0.4064, p90: 0.5996 },
    solidFraction: { p10: 0.1719, p50: 0.4062, p90: 0.6055 },
  },
  repeat: {
    meanAlpha: { p10: 0.4819, p50: 0.7754, p90: 0.9345 },
    solidFraction: { p10: 0.4866, p50: 0.7987, p90: 0.9446 },
  },
  ripple: {
    meanAlpha: { p10: 0.5264, p50: 0.7846, p90: 0.8771 },
    solidFraction: { p10: 0.5535, p50: 0.8403, p90: 0.9319 },
  },
  riso: {
    meanAlpha: { p10: 0.7507, p50: 0.8931, p90: 0.9564 },
    solidFraction: { p10: 0.7637, p50: 0.9034, p90: 0.9668 },
  },
  roadStitch: {
    meanAlpha: { p10: 0.0043, p50: 0.0104, p90: 0.0184 },
    solidFraction: { p10: 0.0041, p50: 0.01, p90: 0.0178 },
  },
  scalerRinging: {
    meanAlpha: { p10: 0.5124, p50: 0.8105, p90: 0.8978 },
    solidFraction: { p10: 0.516, p50: 0.8274, p90: 0.9156 },
  },
  scanSlip: {
    meanAlpha: { p10: 0.4948, p50: 0.7801, p90: 0.8938 },
    solidFraction: { p10: 0.5015, p50: 0.8089, p90: 0.9149 },
  },
  scooterSlipstream: {
    meanAlpha: { p10: 0.488, p50: 0.7809, p90: 0.8967 },
    solidFraction: { p10: 0.491, p50: 0.8086, p90: 0.9146 },
  },
  seaSalt: {
    meanAlpha: { p10: 0.4755, p50: 0.6219, p90: 0.7676 },
    solidFraction: { p10: 0.4756, p50: 0.7466, p90: 0.8892 },
  },
  seigaiha: {
    meanAlpha: { p10: 0.4052, p50: 0.5433, p90: 0.8906 },
    solidFraction: { p10: 0.4185, p50: 0.5566, p90: 0.9105 },
  },
  sleeperRail: {
    meanAlpha: { p10: 0.4924, p50: 0.7802, p90: 0.896 },
    solidFraction: { p10: 0.4893, p50: 0.8081, p90: 0.9167 },
  },
  slice: {
    meanAlpha: { p10: 0.4914, p50: 0.7808, p90: 0.8958 },
    solidFraction: { p10: 0.494, p50: 0.8088, p90: 0.9153 },
  },
  sodium: {
    meanAlpha: { p10: 0.3686, p50: 0.7349, p90: 0.9455 },
    solidFraction: { p10: 0.3292, p50: 0.7639, p90: 0.948 },
  },
  spin: {
    meanAlpha: { p10: 0.5188, p50: 0.774, p90: 0.8913 },
    solidFraction: { p10: 0.5387, p50: 0.8076, p90: 0.9156 },
  },
  spiral: {
    meanAlpha: { p10: 0.1942, p50: 0.5984, p90: 0.9337 },
    solidFraction: { p10: 0.208, p50: 0.6126, p90: 0.9447 },
  },
  stamp: {
    meanAlpha: { p10: 0.1771, p50: 0.2255, p90: 0.745 },
    solidFraction: { p10: 0.0, p50: 0.0, p90: 0.9605 },
  },
  stripes: {
    meanAlpha: { p10: 0.4454, p50: 0.5888, p90: 0.8278 },
    solidFraction: { p10: 0.4918, p50: 0.6372, p90: 0.8677 },
  },
  sunbleachedTarp: {
    meanAlpha: { p10: 0.4626, p50: 0.7313, p90: 0.8371 },
    solidFraction: { p10: 0.4791, p50: 0.7971, p90: 0.9107 },
  },
  sunburst: {
    meanAlpha: { p10: 0.1523, p50: 0.4005, p90: 0.6576 },
    solidFraction: { p10: 0.143, p50: 0.3988, p90: 0.6591 },
  },
  sway: {
    meanAlpha: { p10: 0.5039, p50: 0.7766, p90: 0.8866 },
    solidFraction: { p10: 0.5084, p50: 0.8102, p90: 0.9154 },
  },
  tapeWow: {
    meanAlpha: { p10: 0.4994, p50: 0.7783, p90: 0.8903 },
    solidFraction: { p10: 0.5045, p50: 0.8108, p90: 0.9156 },
  },
  templeZigzag: {
    meanAlpha: { p10: 0.0401, p50: 0.0865, p90: 0.1311 },
    solidFraction: { p10: 0.0325, p50: 0.074, p90: 0.1116 },
  },
  threshold: {
    meanAlpha: { p10: 0.6726, p50: 0.7893, p90: 0.9096 },
    solidFraction: { p10: 0.661, p50: 0.8183, p90: 0.9057 },
  },
  tiles: {
    meanAlpha: { p10: 0.2604, p50: 0.3732, p90: 0.4239 },
    solidFraction: { p10: 0.2555, p50: 0.3767, p90: 0.4266 },
  },
  tunnelDraft: {
    meanAlpha: { p10: 0.5001, p50: 0.7812, p90: 0.8918 },
    solidFraction: { p10: 0.5196, p50: 0.8076, p90: 0.9184 },
  },
  typhoonShear: {
    meanAlpha: { p10: 0.5026, p50: 0.7784, p90: 0.8941 },
    solidFraction: { p10: 0.5078, p50: 0.8102, p90: 0.9153 },
  },
  uroko: {
    meanAlpha: { p10: 0.2634, p50: 0.3497, p90: 0.4393 },
    solidFraction: { p10: 0.1348, p50: 0.2068, p90: 0.2789 },
  },
  viaductJoints: {
    meanAlpha: { p10: 0.0567, p50: 0.0688, p90: 0.0836 },
    solidFraction: { p10: 0.0476, p50: 0.0635, p90: 0.073 },
  },
  vortex: {
    meanAlpha: { p10: 0.5248, p50: 0.7793, p90: 0.8852 },
    solidFraction: { p10: 0.5401, p50: 0.8127, p90: 0.9171 },
  },
  wetConcrete: {
    meanAlpha: { p10: 0.4873, p50: 0.7715, p90: 0.8825 },
    solidFraction: { p10: 0.4872, p50: 0.8077, p90: 0.9153 },
  },
  windows: {
    meanAlpha: { p10: 0.0518, p50: 0.1381, p90: 0.3001 },
    solidFraction: { p10: 0.0526, p50: 0.1392, p90: 0.2864 },
  },
  wires: {
    meanAlpha: { p10: 0.0347, p50: 0.0689, p90: 0.1494 },
    solidFraction: { p10: 0.0346, p50: 0.0689, p90: 0.1496 },
  },
  xerox: {
    meanAlpha: { p10: 0.4709, p50: 0.7682, p90: 0.8721 },
    solidFraction: { p10: 0.4763, p50: 0.7811, p90: 0.8794 },
  },
};
