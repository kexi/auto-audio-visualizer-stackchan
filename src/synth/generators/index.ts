/**
 * 実装付きカタログ（InlineGeneratorCatalog）。
 * 検証・コスト計算だけなら ../catalog.ts の GeneratorCatalog（純粋なメタデータ層）で足りる。
 */
import type { GeneratorDefinition } from '../types';
import { branchGenerator } from './branch';
import { cellsGenerator } from './cells';
import { cheapLedGenerator } from './cheapLed';
import { concentricGenerator } from './concentric';
import { crtGenerator } from './crt';
import { dropoutGenerator } from './dropout';
import { flowGenerator } from './flow';
import { fluorescentGenerator } from './fluorescent';
import { gridGenerator } from './grid';
import { grilleGenerator } from './grille';
import { inkGenerator } from './ink';
import { invertGenerator } from './invert';
import { kaleidoGenerator } from './kaleido';
import { mirrorGenerator } from './mirror';
import { misprintGenerator } from './misprint';
import { neonGenerator } from './neon';
import { noiseGenerator } from './noise';
import { pixelateGenerator } from './pixelate';
import { pointsGenerator } from './points';
import { posterizeGenerator } from './posterize';
import { pulseGenerator } from './pulse';
import { repeatGenerator } from './repeat';
import { rippleGenerator } from './ripple';
import { sliceGenerator } from './slice';
import { sodiumGenerator } from './sodium';
import { stripesGenerator } from './stripes';
import { swayGenerator } from './sway';
import { thresholdGenerator } from './threshold';
import { tilesGenerator } from './tiles';
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
export { noiseGenerator, noiseDef } from './noise';
export { vortexGenerator, vortexDef } from './vortex';
export { flowGenerator, flowDef } from './flow';
export { rippleGenerator, rippleDef } from './ripple';
export { swayGenerator, swayDef } from './sway';
export { pulseGenerator, pulseDef } from './pulse';
export { mirrorGenerator, mirrorDef } from './mirror';
export { repeatGenerator, repeatDef } from './repeat';
export { pixelateGenerator, pixelateDef } from './pixelate';
export { thresholdGenerator, thresholdDef } from './threshold';
export { dropoutGenerator, dropoutDef } from './dropout';
export { kaleidoGenerator, kaleidoDef } from './kaleido';
export { sliceGenerator, sliceDef } from './slice';
export { posterizeGenerator, posterizeDef } from './posterize';
export { invertGenerator, invertDef } from './invert';
export { neonGenerator, neonDef } from './neon';
export { inkGenerator, inkDef } from './ink';
export { crtGenerator, crtDef } from './crt';
export { cheapLedGenerator, cheapLedDef } from './cheapLed';
export { fluorescentGenerator, fluorescentDef } from './fluorescent';
export { wetConcreteGenerator, wetConcreteDef } from './wetConcrete';
export { misprintGenerator, misprintDef } from './misprint';
export { sodiumGenerator, sodiumDef } from './sodium';

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
  // fields
  noiseGenerator,
  vortexGenerator,
  flowGenerator,
  rippleGenerator,
  swayGenerator,
  pulseGenerator,
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
  // materials
  neonGenerator,
  inkGenerator,
  crtGenerator,
  cheapLedGenerator,
  fluorescentGenerator,
  wetConcreteGenerator,
  misprintGenerator,
  sodiumGenerator,
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
