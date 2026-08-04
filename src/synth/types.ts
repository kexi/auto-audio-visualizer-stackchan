export type GeneratorCategory = 'source' | 'field' | 'modifier' | 'material';
export type CostClass = 'micro' | 'light' | 'medium' | 'heavy';
/** inline: GLSL 関数として融合 / pass: 独立した FBO パス */
export type GeneratorImpl = 'inline' | 'pass';
/** Generator の出力型。inline は field/vector/color、pass は texture。 */
export type PortType = 'field' | 'vector' | 'color' | 'texture';

export interface GeneratorTags {
  environment?: string[];
  culturalTexture?: string[];
  material?: string[];
  motion?: string[];
  affect?: string[];
}

export type ParameterKind = 'number' | 'int' | 'bool' | 'enum';

export interface ParameterDefinition {
  id: string;
  label: string;
  kind: ParameterKind;
  /** number / int のとき必須 */
  min?: number;
  max?: number;
  /** enum のとき必須 */
  options?: string[];
  default: number | string | boolean;
  /** Modulation Route の target になれるか */
  modulatable: boolean;
}

export interface GeneratorCost {
  /** この Generator が要求する描画パス数。inline は 0。 */
  passes: number;
  /** フルスクリーン1パスを 1.0 としたときの相対フィルレート負荷。 */
  relativeFill: number;
  /** 前フレームの状態を持つか（粒子・流体・フィードバック）。 */
  stateful: boolean;
}

export interface GeneratorDefinition {
  id: string;
  version: number;
  category: GeneratorCategory;
  costClass: CostClass;
  impl: GeneratorImpl;
  output: PortType;
  tags: GeneratorTags;
  parameters: ParameterDefinition[];
  cost: GeneratorCost;
}

export interface VisualOperator {
  /** Patch 内で一意 */
  id: string;
  generatorId: string;
  generatorVersion: number;
  parameters: Record<string, number | string | boolean>;
}

export type ModulationPolarity = 'unipolar' | 'bipolar';

export interface ModulationRoute {
  /** "audio:bass" | "audio:mid" | "audio:treble" | "audio:level" | "audio:beat"
   *  | "audio:barPhase" | "audio:beatPhase" | "time" | "operator:<opId>" */
  source: string;
  /** "<opId>.<paramId>" */
  target: string;
  amount: number;
  polarity: ModulationPolarity;
  /** 平滑化の時定数（秒）。 */
  smoothing: number;
}

export type PaletteMode = 'mono' | 'analogous' | 'complementary' | 'triadic' | 'rainbow';

export interface PaletteSpec {
  mode: PaletteMode;
  hueOffset: number; // 0..360
  saturation: number; // 0..100
  lightness: number; // 0..100
}

export interface CompositionSpec {
  /** 対称・繰り返し数 */
  symmetry: number;
  /** 全体スケール */
  scale: number;
  /** 全体の動きの速さ */
  speed: number;
}

export type QualityTier = 'low' | 'medium' | 'high';

export interface VisualPatch {
  schemaVersion: number;
  seed: string;
  operators: VisualOperator[];
  routes: ModulationRoute[];
  palette: PaletteSpec;
  composition: CompositionSpec;
  qualityTier: QualityTier;
}

export interface RenderBudget {
  maxCost: number;
  maxPasses: number;
  maxHeavyGenerators: number;
  maxStatefulGenerators: number;
}
