import type { GeneratorDefinition } from '../types';

/**
 * Category → signature convention for inline generators.
 *
 * | category  | output | signature                    | meaning                          |
 * |-----------|--------|------------------------------|----------------------------------|
 * | source    | field  | float FN(vec2 p)             | density 0..1                     |
 * | field     | vector | vec2 FN(vec2 p)              | coordinate displacement          |
 * | modifier  | vector | vec2 FN(vec2 p)              | coord transform (BEFORE source)  |
 * | modifier  | field  | float FN(float v, vec2 p)    | value transform (AFTER source)   |
 * | material  | color  | vec4 FN(float v, vec2 p)     | premultiplied-alpha final color  |
 *
 * **modifier is coord vs value based on output type**:
 * - `output: 'vector'` → coordinate modifier (applied before sources)
 * - `output: 'field'`  → value modifier (applied after sources)
 */

export interface InlineGenerator {
  def: GeneratorDefinition; // impl is 'inline'
  /**
   * GLSL function body. Function name is given as fnName (unique within Patch).
   * Parameters are referenced via uniform names from uniform(paramId).
   */
  emit(ctx: EmitContext): string;
}

export interface EmitContext {
  /** Unique function name for this Operator. */
  fnName: string;
  /** paramId → uniform name (u_<opId>_<paramId>). */
  uniform: (paramId: string) => string;
  /** Named-RNG namespace-hash uniform name for this Operator. */
  nsUniform: string;
  /** Seed u32 uniform name (shared across Patch). */
  seedUniform: string;
}

/** Catalog of inline generators keyed by generator id. */
export interface InlineGeneratorCatalog {
  get(id: string): InlineGenerator | undefined;
  all(): InlineGenerator[];
}
