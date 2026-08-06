import type { GeneratorDefinition } from '../types';
import type { EmitContext, InlineGenerator } from './types';

/**
 * Arch tunnel fly-through — raymarched 3D, the underpass seen from inside.
 *
 * Source なので返り値は 0..1 の density。NdotL（ヘッドライト）+ 簡易 AO +
 * 距離フェードを 0..1 に写す。march は定数上限 + break（M1 Air 保護）。
 */
export const sdfTunnelDef: GeneratorDefinition = {
  id: 'sdfTunnel',
  version: 1,
  category: 'source',
  costClass: 'heavy',
  impl: 'inline',
  output: 'field',
  tags: {
    environment: ['urban'],
    material: ['concrete'],
    motion: ['flythrough'],
    affect: ['subterranean', 'propulsive', 'infrastructural', 'cinematic'],
  },
  parameters: [
    {
      id: 'bore',
      label: 'Bore',
      kind: 'number',
      min: 0.35,
      max: 1.1,
      default: 0.6,
      modulatable: true,
    },
    {
      id: 'pitch',
      label: 'Rib Pitch',
      kind: 'number',
      min: 0.35,
      max: 1.6,
      default: 0.8,
      modulatable: true,
    },
    {
      id: 'speed',
      label: 'Speed',
      kind: 'number',
      min: 0,
      max: 2,
      default: 0.85,
      modulatable: true,
    },
  ],
  cost: { passes: 0, relativeFill: 1.0, stateful: false },
};

export const sdfTunnelGenerator: InlineGenerator = {
  def: sdfTunnelDef,
  preludes: ['sdf3d'],
  emit(ctx: EmitContext): string {
    const { fnName, uniform, nsUniform, seedUniform } = ctx;
    const uBore = uniform('bore');
    const uPitch = uniform('pitch');
    const uSpeed = uniform('speed');
    const map = `${fnName}_map`;
    const nrm = `${fnName}_nrm`;
    const axis = `${fnName}_axis`;
    /** synthRand shorthand: index is hashCombine(idx, k). */
    const r = (idx: string, k: string) =>
      `synthRand(${seedUniform}, ${nsUniform}, synthHashCombine(${idx}, ${k}))`;
    return /* glsl */ `
// sdfTunnel source: raymarched fly-through of an endlessly repeating arch tunnel
// The bore axis snakes with z, so the vanishing point drifts instead of sitting
// dead centre. Seed picks the snake phases and the conduit layout.
vec2 ${axis}(float z) {
  float a0 = ${r('0u', '1u')} * 6.28318530718;
  float a1 = ${r('0u', '2u')} * 6.28318530718;
  return vec2(sin(z * 0.31 + a0) * 0.26, sin(z * 0.19 + a1) * 0.15);
}

float ${map}(vec3 pos) {
  float bore = clamp(${uBore}, 0.35, 1.1);
  float pitch = clamp(${uPitch}, 0.35, 1.6);
  vec2 rp = pos.xy - ${axis}(pos.z);
  // air inside the bore, cut off by the floor slab -> an arch section
  float d = bore - length(rp);
  d = min(d, rp.y + bore * 0.62);
  // rib rings repeated along the axis (solid, so min() carves them out of the air)
  float qz = mod(pos.z + 0.5 * pitch, pitch) - 0.5 * pitch;
  d = min(d, sd3Torus(vec3(rp.x, qz, rp.y), vec2(bore * 0.93, bore * 0.1)));
  // conduits running the whole length, bolted to the wall
  for (int i = 0; i < 4; i++) {
    uint idx = uint(i);
    float ang = ${r('idx', '11u')} * 6.28318530718;
    float rad = bore * (0.7 + 0.22 * ${r('idx', '12u')});
    float pr = bore * (0.035 + 0.05 * ${r('idx', '13u')});
    d = min(d, length(rp - vec2(cos(ang), sin(ang)) * rad) - pr);
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
  float bore = clamp(${uBore}, 0.35, 1.1);
  float spd = clamp(${uSpeed}, 0.0, 2.0);
  float z0 = uTime * spd * 1.2;
  vec3 ro = vec3(${axis}(z0) + vec2(sin(uTime * 0.7), sin(uTime * 0.53) * 0.8) * bore * 0.05, z0);
  vec3 rd = normalize(vec3(p, 0.85));
  rd.xy = rot2(rd.xy, sin(uTime * 0.11) * 0.14);

  // constant step ceiling + break: never let a grazing ray stall the frame
  const int MAX_STEPS = 56;
  const float MAX_T = 18.0;
  float t = 0.02;
  float d = 0.0;
  int hitStep = -1;
  for (int i = 0; i < MAX_STEPS; i++) {
    d = ${map}(ro + rd * t);
    if (d < 0.0018 + 0.0016 * t) { hitStep = i; break; }
    // the snaking axis makes the field a non-exact SDF; undershoot on purpose
    t += d * 0.72;
    if (t > MAX_T) break;
  }
  if (hitStep < 0) return 0.0;

  vec3 pos = ro + rd * t;
  vec3 n = ${nrm}(pos);
  vec3 ld = normalize(ro - pos);
  float ndl = clamp(dot(n, ld), 0.0, 1.0);
  float rim = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 2.5);
  // one-tap AO: how much room is left along the normal
  float ao = mix(0.32, 1.0, clamp(${map}(pos + n * 0.28) / 0.28, 0.0, 1.0));
  float crowd = 1.0 - 0.35 * (float(hitStep) / float(MAX_STEPS));
  float lamp = (0.85 + 0.3 * uBeat) / (1.0 + 0.16 * t * t);
  float lit = (0.16 + 0.84 * ndl) * ao * crowd * lamp + rim * 0.3 * lamp;
  float fog = exp(-t * 0.13);
  // 0.07..0.95 so the material downstream always gets mid tones, never a flat clip
  return clamp((0.07 + 0.88 * clamp(lit, 0.0, 1.0)) * fog, 0.0, 1.0);
}
`.trim();
  },
};
