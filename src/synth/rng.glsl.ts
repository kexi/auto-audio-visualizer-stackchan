/**
 * rng.ts と bit-exact に一致する GLSL ES 3.00 実装。
 * 生成シェーダに挿入して使う（#version は含めない）。
 *
 * 提供関数:
 * - uint synthHashU32(uint x)
 * - uint synthHashCombine(uint a, uint b)
 * - float synthRand(uint seed, uint ns, uint index)  // 0..1、上位24bitのみ
 */
export const RNG_GLSL = /* glsl */ `
// lowbias32 (Chris Wellons) — 32bit 整数ハッシュ
uint synthHashU32(uint x) {
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}

// hashCombine(a, b) = hashU32(a ^ hashU32(b))
uint synthHashCombine(uint a, uint b) {
  return synthHashU32(a ^ synthHashU32(b));
}

// 0..1。上位 24bit のみ使用（float32/float64 で正確に表現でき、CPU と bit-exact）
float synthRand(uint seed, uint ns, uint index) {
  uint h = synthHashCombine(synthHashCombine(seed, ns), index);
  return float(h >> 8u) / 16777216.0;
}
`;
