/**
 * 実装付きカタログ（InlineGeneratorCatalog）。
 * 検証・コスト計算だけなら ../catalog.ts の GeneratorCatalog（純粋なメタデータ層）で足りる。
 */
import type { GeneratorDefinition } from '../types';
import { asanohaGenerator } from './asanoha';
import { asphaltIridescenceGenerator } from './asphaltIridescence';
import { beatMoireGenerator } from './beatMoire';
import { bellowsHoseGenerator } from './bellowsHose';
import { branchGenerator } from './branch';
import { brakeLightRainGenerator } from './brakeLightRain';
import { busJacquardGenerator } from './busJacquard';
import { busPolarizationGenerator } from './busPolarization';
import { cassetteWindowGenerator } from './cassetteWindow';
import { cellsGenerator } from './cells';
import { cheapLedGenerator } from './cheapLed';
import { concentricGenerator } from './concentric';
import { coneFieldGenerator } from './coneField';
import { corruptSaveGenerator } from './corruptSave';
import { crtGenerator } from './crt';
import { dropoutGenerator } from './dropout';
import { fanGuardGenerator } from './fanGuard';
import { flowGenerator } from './flow';
import { fluorescentGenerator } from './fluorescent';
import { flyoverBeamsGenerator } from './flyoverBeams';
import { freezerCyanGenerator } from './freezerCyan';
import { gridGenerator } from './grid';
import { grilleGenerator } from './grille';
import { harborBackwashGenerator } from './harborBackwash';
import { hillClimbGenerator } from './hillClimb';
import { humidityLensGenerator } from './humidityLens';
import { inkGenerator } from './ink';
import { invertGenerator } from './invert';
import { kaleidoGenerator } from './kaleido';
import { kumikoGenerator } from './kumiko';
import { macroblockGenerator } from './macroblock';
import { minidvFadeGenerator } from './minidvFade';
import { mirrorGenerator } from './mirror';
import { misprintGenerator } from './misprint';
import { mooringRopeGenerator } from './mooringRope';
import { neonGenerator } from './neon';
import { nightMarketCurtainGenerator } from './nightMarketCurtain';
import { noiseGenerator } from './noise';
import { paCarpetGenerator } from './paCarpet';
import { pcbMazeGenerator } from './pcbMaze';
import { pixelateGenerator } from './pixelate';
import { pointsGenerator } from './points';
import { polymeterGenerator } from './polymeter';
import { posterizeGenerator } from './posterize';
import { pulseGenerator } from './pulse';
import { qilouShutterGenerator } from './qilouShutter';
import { repeatGenerator } from './repeat';
import { rippleGenerator } from './ripple';
import { roadStitchGenerator } from './roadStitch';
import { scanSlipGenerator } from './scanSlip';
import { seigaihaGenerator } from './seigaiha';
import { sleeperRailGenerator } from './sleeperRail';
import { sliceGenerator } from './slice';
import { sodiumGenerator } from './sodium';
import { stripesGenerator } from './stripes';
import { swayGenerator } from './sway';
import { tapeWowGenerator } from './tapeWow';
import { templeZigzagGenerator } from './templeZigzag';
import { thresholdGenerator } from './threshold';
import { tilesGenerator } from './tiles';
import { tunnelDraftGenerator } from './tunnelDraft';
import { typhoonShearGenerator } from './typhoonShear';
import { viaductJointsGenerator } from './viaductJoints';
import { vortexGenerator } from './vortex';
import { wetConcreteGenerator } from './wetConcrete';
import { wiresGenerator } from './wires';
import type { InlineGenerator, InlineGeneratorCatalog } from './types';

export type { EmitContext, InlineGenerator, InlineGeneratorCatalog } from './types';
export { gridGenerator, gridDef } from './grid';
export { pointsGenerator, pointsDef } from './points';
export { branchGenerator, branchDef } from './branch';
export { cellsGenerator, cellsDef } from './cells';
export { tilesGenerator, tilesDef } from './tiles';
export { wiresGenerator, wiresDef } from './wires';
export { concentricGenerator, concentricDef } from './concentric';
export { grilleGenerator, grilleDef } from './grille';
export { stripesGenerator, stripesDef } from './stripes';
export { qilouShutterGenerator, qilouShutterDef } from './qilouShutter';
export { nightMarketCurtainGenerator, nightMarketCurtainDef } from './nightMarketCurtain';
export { roadStitchGenerator, roadStitchDef } from './roadStitch';
export { flyoverBeamsGenerator, flyoverBeamsDef } from './flyoverBeams';
export { fanGuardGenerator, fanGuardDef } from './fanGuard';
export { mooringRopeGenerator, mooringRopeDef } from './mooringRope';
export { viaductJointsGenerator, viaductJointsDef } from './viaductJoints';
export { busJacquardGenerator, busJacquardDef } from './busJacquard';
export { templeZigzagGenerator, templeZigzagDef } from './templeZigzag';
export { polymeterGenerator, polymeterDef } from './polymeter';
export { pcbMazeGenerator, pcbMazeDef } from './pcbMaze';
export { bellowsHoseGenerator, bellowsHoseDef } from './bellowsHose';
export { cassetteWindowGenerator, cassetteWindowDef } from './cassetteWindow';
export { seigaihaGenerator, seigaihaDef } from './seigaiha';
export { asanohaGenerator, asanohaDef } from './asanoha';
export { kumikoGenerator, kumikoDef } from './kumiko';
export { noiseGenerator, noiseDef } from './noise';
export { vortexGenerator, vortexDef } from './vortex';
export { flowGenerator, flowDef } from './flow';
export { rippleGenerator, rippleDef } from './ripple';
export { swayGenerator, swayDef } from './sway';
export { pulseGenerator, pulseDef } from './pulse';
export { typhoonShearGenerator, typhoonShearDef } from './typhoonShear';
export { tapeWowGenerator, tapeWowDef } from './tapeWow';
export { coneFieldGenerator, coneFieldDef } from './coneField';
export { humidityLensGenerator, humidityLensDef } from './humidityLens';
export { tunnelDraftGenerator, tunnelDraftDef } from './tunnelDraft';
export { hillClimbGenerator, hillClimbDef } from './hillClimb';
export { harborBackwashGenerator, harborBackwashDef } from './harborBackwash';
export { sleeperRailGenerator, sleeperRailDef } from './sleeperRail';
export { mirrorGenerator, mirrorDef } from './mirror';
export { repeatGenerator, repeatDef } from './repeat';
export { pixelateGenerator, pixelateDef } from './pixelate';
export { thresholdGenerator, thresholdDef } from './threshold';
export { dropoutGenerator, dropoutDef } from './dropout';
export { kaleidoGenerator, kaleidoDef } from './kaleido';
export { sliceGenerator, sliceDef } from './slice';
export { posterizeGenerator, posterizeDef } from './posterize';
export { invertGenerator, invertDef } from './invert';
export { macroblockGenerator, macroblockDef } from './macroblock';
export { corruptSaveGenerator, corruptSaveDef } from './corruptSave';
export { beatMoireGenerator, beatMoireDef } from './beatMoire';
export { scanSlipGenerator, scanSlipDef } from './scanSlip';
export { neonGenerator, neonDef } from './neon';
export { inkGenerator, inkDef } from './ink';
export { crtGenerator, crtDef } from './crt';
export { cheapLedGenerator, cheapLedDef } from './cheapLed';
export { fluorescentGenerator, fluorescentDef } from './fluorescent';
export { wetConcreteGenerator, wetConcreteDef } from './wetConcrete';
export { misprintGenerator, misprintDef } from './misprint';
export { sodiumGenerator, sodiumDef } from './sodium';
export { brakeLightRainGenerator, brakeLightRainDef } from './brakeLightRain';
export { freezerCyanGenerator, freezerCyanDef } from './freezerCyan';
export { minidvFadeGenerator, minidvFadeDef } from './minidvFade';
export { busPolarizationGenerator, busPolarizationDef } from './busPolarization';
export { asphaltIridescenceGenerator, asphaltIridescenceDef } from './asphaltIridescence';
export { paCarpetGenerator, paCarpetDef } from './paCarpet';

const ALL: InlineGenerator[] = [
  // sources
  gridGenerator,
  pointsGenerator,
  branchGenerator,
  cellsGenerator,
  tilesGenerator,
  wiresGenerator,
  concentricGenerator,
  grilleGenerator,
  stripesGenerator,
  qilouShutterGenerator,
  nightMarketCurtainGenerator,
  roadStitchGenerator,
  flyoverBeamsGenerator,
  fanGuardGenerator,
  mooringRopeGenerator,
  viaductJointsGenerator,
  busJacquardGenerator,
  templeZigzagGenerator,
  polymeterGenerator,
  pcbMazeGenerator,
  bellowsHoseGenerator,
  cassetteWindowGenerator,
  seigaihaGenerator,
  asanohaGenerator,
  kumikoGenerator,
  // fields
  noiseGenerator,
  vortexGenerator,
  flowGenerator,
  rippleGenerator,
  swayGenerator,
  pulseGenerator,
  typhoonShearGenerator,
  tapeWowGenerator,
  coneFieldGenerator,
  humidityLensGenerator,
  tunnelDraftGenerator,
  hillClimbGenerator,
  harborBackwashGenerator,
  sleeperRailGenerator,
  // modifiers (coord + value)
  mirrorGenerator,
  repeatGenerator,
  pixelateGenerator,
  thresholdGenerator,
  dropoutGenerator,
  kaleidoGenerator,
  sliceGenerator,
  posterizeGenerator,
  invertGenerator,
  macroblockGenerator,
  corruptSaveGenerator,
  beatMoireGenerator,
  scanSlipGenerator,
  // materials
  neonGenerator,
  inkGenerator,
  crtGenerator,
  cheapLedGenerator,
  fluorescentGenerator,
  wetConcreteGenerator,
  misprintGenerator,
  sodiumGenerator,
  brakeLightRainGenerator,
  freezerCyanGenerator,
  minidvFadeGenerator,
  busPolarizationGenerator,
  asphaltIridescenceGenerator,
  paCarpetGenerator,
];

/** Built-in inline generator catalog (Phase 1 generators). */
export function createInlineCatalog(gens: InlineGenerator[] = ALL): InlineGeneratorCatalog {
  const byId = new Map<string, InlineGenerator>();
  for (const g of gens) {
    byId.set(g.def.id, g);
  }
  return {
    get(id: string): InlineGenerator | undefined {
      return byId.get(id);
    },
    all(): InlineGenerator[] {
      return Array.from(byId.values());
    },
  };
}

export const inlineCatalog: InlineGeneratorCatalog = createInlineCatalog();

/** GeneratorDefinition list for cost/validate integration. */
export function allGeneratorDefinitions(): GeneratorDefinition[] {
  return inlineCatalog.all().map((g) => g.def);
}
