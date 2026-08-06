/**
 * 共有 GLSL プリリュード。
 *
 * RNG_GLSL は全 Patch に無条件で注入される（どの Generator も使いうるので）。
 * プリリュードはその逆で opt-in: InlineGenerator が `preludes` にキーを宣言した
 * ときだけ、assembler が Generator 関数群の前に一度だけ出力する。宣言しない
 * Patch のシェーダは 1 バイトも変わらない。
 *
 * 未知のキーは throw する。サイレントに無視すると、タイプミスした Generator が
 * 「なぜかリンクエラーになる Patch」として本番で初めて発覚することになる。
 */

/**
 * 3D SDF のプリミティブと演算子。レイマーチする source が共有する。
 *
 * **純粋関数のみ**。scene の `map()` に依存するもの（march ループ・法線推定）は
 * ここに置けない: GLSL に関数ポインタが無く、map は Generator ごとに違うため。
 * 各 Generator が自分の `<fnName>_map` と march ループを書く。ハードサーフェス /
 * フォグ蓄積の使い分けができるので、むしろ都合がよい。
 *
 * 命名は `sd3*` / `op3*` / `rot2`。GLSL ES 3.00 の予約語（`half` など）や
 * 既存の Generator 関数名と衝突しないこと。
 */
const SDF3D_GLSL = /* glsl */ `
// ---- prelude: sdf3d (primitives + operators, pure functions only) ----
float sd3Sphere(vec3 p, float r) {
  return length(p) - r;
}

float sd3Box(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// ring in the xz plane; p.y is the axis
float sd3Torus(vec3 p, vec2 t) {
  vec2 q = vec2(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}

float sd3Capsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a;
  vec3 ba = b - a;
  float seg = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * seg) - r;
}

float sd3Plane(vec3 p, vec3 n, float h) {
  return dot(p, normalize(n)) + h;
}

float op3SmoothUnion(float a, float b, float k) {
  float kk = max(k, 1e-4);
  float t = clamp(0.5 + 0.5 * (b - a) / kk, 0.0, 1.0);
  return mix(b, a, t) - kk * t * (1.0 - t);
}

// carve b out of a
float op3SmoothSubtract(float a, float b, float k) {
  float kk = max(k, 1e-4);
  float t = clamp(0.5 - 0.5 * (a + b) / kk, 0.0, 1.0);
  return mix(a, -b, t) + kk * t * (1.0 - t);
}

// infinite domain repetition; axes whose cell size is <= 0 are left untouched
vec3 op3Rep(vec3 p, vec3 c) {
  vec3 safe = max(c, vec3(1e-3));
  vec3 q = mod(p + 0.5 * safe, safe) - 0.5 * safe;
  return mix(p, q, step(1e-3, c));
}

vec2 rot2(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}
`;

/** キー → GLSL。Map なので get() が `string | undefined` になり、未知キーを型で拾える。 */
const PRELUDE_SOURCES: ReadonlyMap<string, string> = new Map([['sdf3d', SDF3D_GLSL]]);

/** 登録済みプリリュードキー（宣言順）。 */
export function knownPreludeKeys(): string[] {
  return [...PRELUDE_SOURCES.keys()];
}

/**
 * キー列を重複排除して GLSL に展開する。
 *
 * 出力順は **最初に現れた順**（assembler は operator 配列順で渡す）なので、
 * 同じ Patch なら常に同じ文字列になる = fragSrc の決定性が保たれる。
 * 1 つも無ければ空文字列を返し、assembler は何も出力しない。
 */
export function resolvePreludes(keys: Iterable<string>): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const src = PRELUDE_SOURCES.get(key);
    if (src === undefined) {
      throw new Error(
        `resolvePreludes: unknown prelude "${key}" (known: ${knownPreludeKeys().join(', ')})`,
      );
    }
    parts.push(src.trim());
  }
  return parts.join('\n\n');
}
