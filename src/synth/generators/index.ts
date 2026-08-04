import type { GeneratorDefinition } from '../types';
import { gridGenerator } from './grid';
import { mirrorGenerator } from './mirror';
import { neonGenerator } from './neon';
import { noiseGenerator } from './noise';
import type { InlineGenerator, InlineGeneratorCatalog } from './types';

export type { EmitContext, InlineGenerator, InlineGeneratorCatalog } from './types';
export { gridGenerator, gridDef } from './grid';
export { noiseGenerator, noiseDef } from './noise';
export { mirrorGenerator, mirrorDef } from './mirror';
export { neonGenerator, neonDef } from './neon';

const ALL: InlineGenerator[] = [gridGenerator, noiseGenerator, mirrorGenerator, neonGenerator];

/** Built-in inline generator catalog (one generator per category for Phase 1). */
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
