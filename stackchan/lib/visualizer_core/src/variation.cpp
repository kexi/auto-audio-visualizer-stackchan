#include "visualizer/variation.hpp"

#include <array>
#include <cstdio>
#include <vector>

namespace stackchan {
namespace {

std::uint32_t rotateLeft(std::uint32_t value, int bits) {
  return (value << bits) | (value >> (32 - bits));
}

std::vector<std::uint16_t> toUtf16(const std::string& text) {
  std::vector<std::uint16_t> units;
  for (std::size_t index = 0; index < text.size();) {
    const auto first = static_cast<std::uint8_t>(text[index]);
    std::uint32_t codePoint = 0xFFFDU;
    std::size_t sequenceSize = 1;
    const bool isAscii = first < 0x80U;
    const bool isTwoByte = (first & 0xE0U) == 0xC0U && index + 1 < text.size();
    const bool isThreeByte = (first & 0xF0U) == 0xE0U && index + 2 < text.size();
    const bool isFourByte = (first & 0xF8U) == 0xF0U && index + 3 < text.size();
    if (isAscii) {
      codePoint = first;
    } else if (isTwoByte) {
      codePoint = ((first & 0x1FU) << 6U) | (static_cast<std::uint8_t>(text[index + 1]) & 0x3FU);
      sequenceSize = 2;
    } else if (isThreeByte) {
      codePoint = ((first & 0x0FU) << 12U) |
                  ((static_cast<std::uint8_t>(text[index + 1]) & 0x3FU) << 6U) |
                  (static_cast<std::uint8_t>(text[index + 2]) & 0x3FU);
      sequenceSize = 3;
    } else if (isFourByte) {
      codePoint = ((first & 0x07U) << 18U) |
                  ((static_cast<std::uint8_t>(text[index + 1]) & 0x3FU) << 12U) |
                  ((static_cast<std::uint8_t>(text[index + 2]) & 0x3FU) << 6U) |
                  (static_cast<std::uint8_t>(text[index + 3]) & 0x3FU);
      sequenceSize = 4;
    }
    index += sequenceSize;

    const bool needsSurrogatePair = codePoint > 0xFFFFU;
    if (needsSurrogatePair) {
      const std::uint32_t surrogate = codePoint - 0x10000U;
      units.push_back(static_cast<std::uint16_t>(0xD800U + (surrogate >> 10U)));
      units.push_back(static_cast<std::uint16_t>(0xDC00U + (surrogate & 0x3FFU)));
    } else {
      units.push_back(static_cast<std::uint16_t>(codePoint));
    }
  }
  return units;
}

std::uint32_t xmur3(const std::string& text) {
  const auto units = toUtf16(text);
  std::uint32_t hash = 1779033703U ^ static_cast<std::uint32_t>(units.size());
  for (const std::uint16_t unit : units) {
    hash = (hash ^ unit) * 3432918353U;
    hash = rotateLeft(hash, 13);
  }
  hash = (hash ^ (hash >> 16U)) * 2246822507U;
  hash = (hash ^ (hash >> 13U)) * 3266489909U;
  return hash ^ (hash >> 16U);
}

std::uint32_t mulberryNext(std::uint32_t& state) {
  state += 0x6d2b79f5U;
  std::uint32_t value = (state ^ (state >> 15U)) * (1U | state);
  value = (value + ((value ^ (value >> 7U)) * (61U | value))) ^ value;
  return value ^ (value >> 14U);
}

float nextUnit(std::uint32_t& state) {
  return static_cast<float>(mulberryNext(state)) / 4294967296.0F;
}

int inclusiveInt(float value, int low, int high) {
  return low + static_cast<int>(value * static_cast<float>(high - low + 1));
}

float hueSpread(PaletteMode mode) {
  switch (mode) {
  case PaletteMode::Mono:
    return 12.0F;
  case PaletteMode::Analogous:
    return 40.0F;
  case PaletteMode::Complementary:
    return 180.0F;
  case PaletteMode::Triadic:
    return 120.0F;
  case PaletteMode::Rainbow:
    return 360.0F;
  }
  return 12.0F;
}

constexpr std::array<const char*, 24> kAdjectives = {
    "neon",    "acid",     "velvet", "ghost",  "cyber",  "lunar", "solar",   "hyper",
    "retro",   "glass",    "frost",  "ember",  "cosmic", "pixel", "vapor",   "electric",
    "crystal", "midnight", "golden", "plasma", "mystic", "turbo", "quantum", "astro",
};

constexpr std::array<const char*, 24> kNouns = {
    "tiger",   "orchid", "prism",  "nebula", "comet",   "falcon",  "lotus",   "phoenix",
    "serpent", "raven",  "wolf",   "koi",    "dragon",  "panther", "mantis",  "jaguar",
    "sphinx",  "cobra",  "mirage", "aurora", "glacier", "volcano", "tempest", "cipher",
};

} // namespace

float Variation::random(std::uint32_t index) const {
  std::uint32_t state = baseSeed ^ index * 0x9e3779b9U;
  return nextUnit(state);
}

Variation generateVariation(const std::string& seed) {
  Variation variation{};
  variation.seed = seed;
  variation.baseSeed = xmur3(seed);
  std::uint32_t state = variation.baseSeed;
  variation.paletteMode = static_cast<PaletteMode>(inclusiveInt(nextUnit(state), 0, 4));
  variation.hueOffset = nextUnit(state) * 360.0F;
  variation.saturation = 55.0F + nextUnit(state) * 45.0F;
  variation.lightness = 45.0F + nextUnit(state) * 27.0F;
  variation.speed = 0.5F + nextUnit(state) * 1.3F;
  variation.density = 0.55F + nextUnit(state) * 1.45F;
  variation.scale = 0.7F + nextUnit(state) * 0.7F;
  variation.symmetry = inclusiveInt(nextUnit(state), 2, 8);
  variation.direction = nextUnit(state) < 0.5F ? 1 : -1;
  variation.wobble = nextUnit(state);
  variation.shape = nextUnit(state);
  variation.variant = inclusiveInt(nextUnit(state), 0, 3);
  variation.hueSpread = hueSpread(variation.paletteMode);
  return variation;
}

std::string generateReadableSeed(std::uint32_t entropy) {
  std::uint32_t state = entropy;
  const std::size_t adjective = mulberryNext(state) % kAdjectives.size();
  const std::size_t noun = mulberryNext(state) % kNouns.size();
  const unsigned int number = mulberryNext(state) % 1000U;
  char output[48]{};
  std::snprintf(output, sizeof(output), "%s-%s-%03u", kAdjectives[adjective], kNouns[noun], number);
  return output;
}

} // namespace stackchan
