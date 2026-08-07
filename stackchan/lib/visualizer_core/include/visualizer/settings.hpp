#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace stackchan {

enum class SceneId {
  Bars,
  Waveform,
  Particles,
  Radial,
  Rings,
  Lissajous,
  Fluid,
  Smoke,
  Lava,
  Aurora,
  SemanticSynth,
};

enum class HueMode { Cycle, Fixed };
enum class Background { Black, Transparent };
enum class CycleMode { Seconds, Bars };

struct Settings {
  SceneId scene = SceneId::Bars;
  float gain = 1.5F;
  HueMode hueMode = HueMode::Cycle;
  float fixedHue = 200.0F;
  Background background = Background::Black;
  bool autoCycle = false;
  float cycleSeconds = 30.0F;
  CycleMode cycleMode = CycleMode::Seconds;
  std::uint16_t cycleBars = 16;
  bool autoGacha = false;
  std::uint16_t gachaBars = 32;
  std::string seed = "neon-prism-001";
  bool controlsHidden = false;
};

[[nodiscard]] Settings sanitizeSettings(Settings settings);
[[nodiscard]] const char* sceneId(SceneId scene);
[[nodiscard]] const char* sceneName(SceneId scene);
[[nodiscard]] SceneId sceneFromId(const std::string& id);
[[nodiscard]] SceneId shiftedScene(SceneId scene, int delta);
[[nodiscard]] std::size_t sceneCount();

} // namespace stackchan
