/**
 * Generator の実装を変更するときは必ず version を上げる。
 * ただし旧実装は保持しない（最新のみ）。
 * 古い Patch の再現は best-effort であり、Semantic Replay を契約とする。
 *
 * Catalog holds only the latest definition per id.
 * get(id, version): when version is given and does not match the stored version, returns undefined.
 *
 * 純粋なメタデータ層。GLSL 実装を伴うカタログは generators/index.ts の
 * InlineGeneratorCatalog。
 */
import type { GeneratorCategory, GeneratorDefinition } from './types';

export interface GeneratorCatalog {
  get(id: string, version?: number): GeneratorDefinition | undefined;
  has(id: string): boolean;
  all(): GeneratorDefinition[];
  byCategory(category: GeneratorCategory): GeneratorDefinition[];
}

export function createCatalog(defs: GeneratorDefinition[]): GeneratorCatalog {
  const byId = new Map<string, GeneratorDefinition>();
  for (const def of defs) {
    byId.set(def.id, def);
  }

  return {
    get(id: string, version?: number): GeneratorDefinition | undefined {
      const def = byId.get(id);
      if (!def) return undefined;
      if (version !== undefined && def.version !== version) return undefined;
      return def;
    },
    has(id: string): boolean {
      return byId.has(id);
    },
    all(): GeneratorDefinition[] {
      return Array.from(byId.values());
    },
    byCategory(category: GeneratorCategory): GeneratorDefinition[] {
      return Array.from(byId.values()).filter((d) => d.category === category);
    },
  };
}
