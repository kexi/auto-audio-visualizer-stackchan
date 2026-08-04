/**
 * 実装付きカタログ（InlineGeneratorCatalog）。
 * 検証・コスト計算だけなら ../catalog.ts の GeneratorCatalog（純粋なメタデータ層）で足りる。
 */
import type { GeneratorDefinition } from '../types';
import { branchGenerator } from './branch';
import { cellsGenerator } from './cells';
import { cheapLedGenerator } from './cheapLed';
import { crtGenerator } from './crt';
import { dropoutGenerator } from './dropout';
import { flowGenerator } from './flow';
import { gridGenerator } from './grid';
import { inkGenerator } from './ink';
import { mirrorGenerator } from './mirror';
import { neonGenerator } from './neon';
import { noiseGenerator } from './noise';
import { pixelateGenerator } from './pixelate';
import { pointsGenerator } from './points';
import { repeatGenerator } from './repeat';
import { thresholdGenerator } from './threshold';
import { vortexGenerator } from './vortex';
import type { InlineGenerator, InlineGeneratorCatalog } from './types';

export type { EmitContext, InlineGenerator, InlineGeneratorCatalog } from './types';
export { gridGenerator, gridDef } from './grid';
export { pointsGenerator, pointsDef } from './points';
export { branchGenerator, branchDef } from './branch';
export { cellsGenerator, cellsDef } from './cells';
export { noiseGenerator, noiseDef } from './noise';
export { vortexGenerator, vortexDef } from './vortex';
export { flowGenerator, flowDef } from './flow';
export { mirrorGenerator, mirrorDef } from './mirror';
export { repeatGenerator, repeatDef } from './repeat';
export { pixelateGenerator, pixelateDef } from './pixelate';
export { thresholdGenerator, thresholdDef } from './threshold';
export { dropoutGenerator, dropoutDef } from './dropout';
export { neonGenerator, neonDef } from './neon';
export { inkGenerator, inkDef } from './ink';
export { crtGenerator, crtDef } from './crt';
export { cheapLedGenerator, cheapLedDef } from './cheapLed';

const ALL: InlineGenerator[] = [
  // sources
  gridGenerator,
  pointsGenerator,
  branchGenerator,
  cellsGenerator,
  // fields
  noiseGenerator,
  vortexGenerator,
  flowGenerator,
  // modifiers (coord + value)
  mirrorGenerator,
  repeatGenerator,
  pixelateGenerator,
  thresholdGenerator,
  dropoutGenerator,
  // materials
  neonGenerator,
  inkGenerator,
  crtGenerator,
  cheapLedGenerator,
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
