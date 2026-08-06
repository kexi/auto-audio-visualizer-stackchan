import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Tumbling cube — raymarched 3D, the one 3D source that reads as a single object
 * rather than as a space. tunnel / lattice / blob all fill the frame; this one is
 * a silhouette you can point at.
 *
 * Source なので返り値は 0..1 の density。面の法線は面内で一定なので、単純な NdotL
 * だと 3 面が 3 段のフラット値になり後段 Material に渡る情報がほぼ消える。ヘッド
 * ライトの距離減衰・fresnel リム・AO で **面内にグラデーションを必ず出す**こと。
 */
export const sdfCubeDef: GeneratorDefinition = {
  id: 'sdfCube',
  version: 1,
  category: 'source',
  costClass: 'heavy',
  impl: 'inline',
  output: 'field',
  tags: {
    material: ['metal', 'plastic'],
    motion: ['tumble', 'spin'],
    affect: ['graphic', 'bold', 'physical'],
  },
  parameters: [
    {
      id: 'style',
      label: 'Style',
      kind: 'enum',
      options: ['solid', 'chamfer', 'frame'],
      default: 'solid',
      modulatable: false,
    },
    {
      id: 'count',
      label: 'Count',
      kind: 'int',
      min: 1,
      max: 4,
      default: 1,
      modulatable: true,
    },
    {
      id: 'spin',
      label: 'Spin',
      kind: 'number',
      min: 0,
      max: 2,
      default: 0.65,
      modulatable: true,
    },
    {
      id: 'size',
      label: 'Size',
      kind: 'number',
      min: 0.25,
      max: 0.8,
      default: 0.5,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 0.9, stateful: false },
};

export const sdfCubeGenerator: InlineGenerator = {
  def: sdfCubeDef,
  preludes: ['sdf3d'],
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uStyle = uniform('style');
    const uCount = uniform('count');
    const uSpin = uniform('spin');
    const uSize = uniform('size');
    const map = `${fnName}_map`;
    const nrm = `${fnName}_nrm`;
    /** synthRand shorthand: index is hashCombine(idx, k). */
    const r = (idx: string, k: string) =>
      `synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(${idx}, ${k}))`;
    return /* glsl */ `
// sdfCube source: 1-4 tumbling cubes. style 0 = solid, 1 = chamfer (cube ∩
// octahedron), 2 = frame (cube minus three through-holes, leaving the 12 edges).
// Two rotation axes at different rates: a single axis reads as a flat polygon.
float ${map}(vec3 pos) {
  int st = clamp(${uStyle}, 0, 2);
  int n = clamp(${uCount}, 1, 4);
  float spin = clamp(${uSpin}, 0.0, 2.0) * (1.0 + 0.12 * uBass);
  float size = clamp(${uSize}, 0.25, 0.8) * (1.0 + 0.05 * uBeat + 0.04 * uBass);
  float d = 1e4;
  for (int i = 0; i < 4; i++) {
    if (i >= n) break;
    uint idx = uint(i);
    // one cube stays dead centre; a cluster orbits so the group still reads
    float orb = (n > 1) ? (0.34 + 0.42 * ${r('idx', '1u')}) : 0.0;
    float oph = ${r('idx', '2u')} * 6.28318530718;
    float orate = 0.22 + 0.4 * ${r('idx', '3u')};
    vec3 c = vec3(
      cos(uTime * orate + oph),
      sin(uTime * orate * 0.81 + oph * 1.6) * 0.72,
      sin(uTime * orate * 0.57 + oph * 2.2) * 0.5) * orb;
    vec3 q = pos - c;
    float ax = uTime * spin * (0.55 + 0.5 * ${r('idx', '4u')}) + ${r('idx', '5u')} * 6.28318530718;
    float ay = uTime * spin * (0.34 + 0.38 * ${r('idx', '6u')}) + ${r('idx', '7u')} * 6.28318530718;
    q.yz = rot2(q.yz, ax);
    q.xz = rot2(q.xz, ay);
    float s = size * (n > 1 ? (0.5 + 0.42 * ${r('idx', '8u')}) : 1.0);
    float cube;
    if (st == 1) {
      // chamfer: intersect the cube with an octahedron to cut all 8 corners
      cube = max(sd3Box(q, vec3(s)), dot(abs(q), vec3(0.57735027)) - s * 1.33);
    } else if (st == 2) {
      // frame: hard subtraction of three axis-aligned holes leaves the edges
      float e = s * 0.8;
      float holes = min(sd3Box(q, vec3(s * 1.7, e, e)),
                    min(sd3Box(q, vec3(e, s * 1.7, e)),
                        sd3Box(q, vec3(e, e, s * 1.7))));
      cube = max(sd3Box(q, vec3(s)), -holes);
    } else {
      cube = sd3Box(q, vec3(s));
    }
    d = min(d, cube);
  }
  return d;
}

vec3 ${nrm}(vec3 pos) {
  vec2 e = vec2(1.0, -1.0) * 0.0022;
  return normalize(
    e.xyy * ${map}(pos + e.xyy) + e.yyx * ${map}(pos + e.yyx) +
    e.yxy * ${map}(pos + e.yxy) + e.xxx * ${map}(pos + e.xxx));
}

float ${fnName}(vec2 p) {
  int n = clamp(${uCount}, 1, 4);
  float size = clamp(${uSize}, 0.25, 0.8) * 1.1;
  vec3 ro = vec3(0.0, 0.0, -2.6);
  vec3 rd = normalize(vec3(p, 0.95));

  // analytic bounding sphere so a missing ray costs one dot product, not 52 maps
  float bound = (n > 1 ? 0.8 : 0.0) + size * 1.75 + 0.1;
  float tca = dot(-ro, rd);
  vec3 closest = ro + rd * tca;
  float perp2 = dot(closest, closest);
  if (perp2 > bound * bound) return 0.0;
  float halfChord = sqrt(max(bound * bound - perp2, 0.0));

  const int MAX_STEPS = 52;
  float tStart = max(tca - halfChord, 0.02);
  float t = tStart;
  float tEnd = tca + halfChord;
  float d = 0.0;
  int hitStep = -1;
  for (int i = 0; i < MAX_STEPS; i++) {
    d = ${map}(ro + rd * t);
    if (d < 0.0014) { hitStep = i; break; }
    t += d * 0.92;
    if (t > tEnd) break;
  }
  if (hitStep < 0) return 0.0;

  vec3 pos = ro + rd * t;
  vec3 n3 = ${nrm}(pos);
  vec3 key = normalize(vec3(0.46, 0.74, -0.52));
  float ndl = clamp(dot(n3, key), 0.0, 1.0);
  float fill = clamp(dot(n3, -key), 0.0, 1.0);
  // A flat face has a constant normal, so NdotL alone would quantise the whole
  // cube to 3 flat levels. These three all vary *inside* a face: the headlight
  // falls off with t, fresnel follows the per-pixel ray, AO opens up away from
  // the edges. Together they keep the density continuous.
  float lamp = 1.0 / (1.0 + 0.13 * t * t);
  float head = clamp(dot(n3, normalize(ro - pos)), 0.0, 1.0);
  float fres = pow(1.0 - clamp(dot(n3, -rd), 0.0, 1.0), 3.0);
  float ao = mix(0.34, 1.0, clamp(${map}(pos + n3 * 0.24) / 0.24, 0.0, 1.0));
  float lit = (0.12 + 0.5 * ndl + 0.16 * fill + 0.42 * head * lamp) * ao + fres * 0.34;
  float fog = exp(-max(t - tStart, 0.0) * 0.22);
  // 0.07..0.95 so the material downstream always gets mid tones
  return clamp((0.07 + 0.88 * clamp(lit, 0.0, 1.0)) * fog, 0.0, 1.0);
}
`.trim();
  },
};
