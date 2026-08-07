#pragma once

#include <cstdint>
#include <string>

namespace stackchan {

enum class PaletteMode { Mono, Analogous, Complementary, Triadic, Rainbow };

struct Variation {
  std::string seed;
  PaletteMode paletteMode = PaletteMode::Mono;
  float hueOffset = 0.0F;
  float hueSpread = 12.0F;
  float saturation = 70.0F;
  float lightness = 55.0F;
  float speed = 1.0F;
  float density = 1.0F;
  float scale = 1.0F;
  int symmetry = 4;
  int direction = 1;
  float wobble = 0.0F;
  float shape = 0.0F;
  int variant = 0;
  std::uint32_t baseSeed = 0;

  [[nodiscard]] float random(std::uint32_t index) const;
};

[[nodiscard]] Variation generateVariation(const std::string& seed);
[[nodiscard]] std::string generateReadableSeed(std::uint32_t entropy);

} // namespace stackchan
