import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Bass-driven metaball — raymarched 3D, smooth-union blobs like a speaker cone
 * pushing mercury. Source なので返り値は 0..1 の density。
 */
export const sdfBlobDef: GeneratorDefinition = {
  id: 'sdfBlob',
  version: 1,
  category: 'source',
  costClass: 'heavy',
  impl: 'inline',
  output: 'field',
  tags: {
    environment: ['club'],
    material: ['mercury', 'speaker'],
    motion: ['pulse'],
    affect: ['physical', 'organic', 'liquid'],
  },
  parameters: [
    {
      id: 'blobs',
      label: 'Blobs',
      kind: 'int',
      min: 2,
      max: 6,
      default: 4,
      modulatable: true,
    },
    {
      id: 'radius',
      label: 'Radius',
      kind: 'number',
      min: 0.12,
      max: 0.45,
      default: 0.26,
      modulatable: true,
    },
    {
      id: 'fuse',
      label: 'Fuse',
      kind: 'number',
      min: 0.05,
      max: 0.4,
      default: 0.18,
      modulatable: true,
    },
    {
      id: 'pulse',
      label: 'Pulse',
      kind: 'number',
      min: 0,
      max: 1,
      default: 0.6,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.95, stateful: false },
};

export const sdfBlobGenerator: InlineGenerator = {
  def: sdfBlobDef,
  preludes: ['sdf3d'],
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uBlobs = uniform('blobs');
    const uRadius = uniform('radius');
    const uFuse = uniform('fuse');
    const uPulse = uniform('pulse');
    const map = `${fnName}_map`;
    const nrm = `${fnName}_nrm`;
    /** synthRand shorthand: index is hashCombine(idx, k). */
    const r = (idx: string, k: string) =>
      `synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(${idx}, ${k}))`;
    return /* glsl */ `
// sdfBlob source: raymarched smooth-union metaballs, radius pumped by bass.
// Blob 0 orbits close to the origin so the cluster is always on screen; the rest
// swing out on seed-derived orbits.
float ${map}(vec3 pos) {
  int n = clamp(${uBlobs}, 2, 6);
  float rad = clamp(${uRadius}, 0.12, 0.45);
  float fuse = clamp(${uFuse}, 0.05, 0.4);
  float pulse = clamp(${uPulse}, 0.0, 1.0);
  float d = 1e4;
  for (int i = 0; i < 6; i++) {
    if (i >= n) break;
    uint idx = uint(i);
    float ph = ${r('idx', '1u')} * 6.28318530718;
    float rate = 0.3 + 0.7 * ${r('idx', '2u')};
    float orb = 0.55 * (0.35 + 0.65 * ${r('idx', '3u')});
    if (i == 0) orb *= 0.22;
    vec3 c = vec3(
      cos(uTime * rate + ph),
      sin(uTime * rate * 0.83 + ph * 1.7) * 0.78,
      sin(uTime * rate * 0.61 + ph * 2.3) * 0.62) * orb;
    float rr = rad * (0.55 + 0.7 * ${r('idx', '4u')});
    rr *= 1.0 + pulse * (0.4 * uBass + 0.14 * sin(uTime * 1.9 + ph));
    d = op3SmoothUnion(d, sd3Sphere(pos - c, rr), fuse);
  }
  return d;
}

vec3 ${nrm}(vec3 pos) {
  vec2 e = vec2(1.0, -1.0) * 0.0025;
  return normalize(
    e.xyy * ${map}(pos + e.xyy) + e.yyx * ${map}(pos + e.yyx) +
    e.yxy * ${map}(pos + e.yxy) + e.xxx * ${map}(pos + e.xxx));
}

float ${fnName}(vec2 p) {
  float rad = clamp(${uRadius}, 0.12, 0.45);
  float fuse = clamp(${uFuse}, 0.05, 0.4);
  float pulse = clamp(${uPulse}, 0.0, 1.0);
  vec3 ro = vec3(0.0, 0.0, -2.3);
  vec3 rd = normalize(vec3(p, 0.9));
  rd.xz = rot2(rd.xz, sin(uTime * 0.13) * 0.12);

  // Analytic bounding sphere: everything lives inside it, so a ray that misses
  // costs one dot product instead of 48 map() calls (this is the M1 Air budget).
  // NOTE: no local named "half" — it is a GLSL ES reserved word.
  float bound = 0.6 + rad * 2.0 * (1.0 + pulse * 0.55) + fuse;
  float tca = dot(-ro, rd);
  vec3 closest = ro + rd * tca;
  float perp2 = dot(closest, closest);
  if (perp2 > bound * bound) return 0.0;
  float halfChord = sqrt(max(bound * bound - perp2, 0.0));

  const int MAX_STEPS = 48;
  float tStart = max(tca - halfChord, 0.02);
  float t = tStart;
  float tEnd = tca + halfChord;
  float d = 0.0;
  int hitStep = -1;
  for (int i = 0; i < MAX_STEPS; i++) {
    d = ${map}(ro + rd * t);
    if (d < 0.0016) { hitStep = i; break; }
    // smooth union only ever undershoots the true distance, so a full step is safe
    t += d * 0.9;
    if (t > tEnd) break;
  }
  if (hitStep < 0) return 0.0;

  vec3 pos = ro + rd * t;
  vec3 n = ${nrm}(pos);
  vec3 key = normalize(vec3(0.5, 0.72, -0.5));
  float ndl = clamp(dot(n, key), 0.0, 1.0);
  float fill = clamp(dot(n, -key), 0.0, 1.0);
  float fres = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0);
  float spec = pow(clamp(dot(reflect(rd, n), key), 0.0, 1.0), 22.0);
  float ao = mix(0.4, 1.0, clamp(${map}(pos + n * 0.22) / 0.22, 0.0, 1.0));
  float lit = (0.14 + 0.66 * ndl + 0.18 * fill) * ao + fres * 0.32 + spec * 0.35;
  // depth fade across the blob body, so the far side never matches the near side
  float fog = exp(-max(t - tStart, 0.0) * 0.28);
  // 0.07..0.95 so the material downstream always gets mid tones
  return clamp((0.07 + 0.88 * clamp(lit, 0.0, 1.0)) * fog, 0.0, 1.0);
}
`.trim();
  },
};
