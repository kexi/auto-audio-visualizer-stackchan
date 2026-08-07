#include "visualizer/settings.hpp"

#include <algorithm>
#include <array>
#include <cmath>

namespace stackchan {
namespace {

constexpr std::array<SceneId, 11> kScenes = {
    SceneId::Bars,  SceneId::Waveform,  SceneId::Particles,     SceneId::Radial,
    SceneId::Rings, SceneId::Lissajous, SceneId::Fluid,         SceneId::Smoke,
    SceneId::Lava,  SceneId::Aurora,    SceneId::SemanticSynth,
};

constexpr std::array<const char*, 11> kSceneIds = {
    "bars",  "waveform", "particles", "radial", "rings",          "lissajous",
    "fluid", "smoke",    "lava",      "aurora", "semantic-synth",
};

constexpr std::array<const char*, 11> kSceneNames = {
    "Bars",      "Waveform", "Particles", "Radial", "Rings",          "Lissajous",
    "Fluid Ink", "Smoke",    "Lava",      "Aurora", "Semantic Synth",
};

std::size_t sceneIndex(SceneId scene) {
  const auto iterator = std::find(kScenes.begin(), kScenes.end(), scene);
  const bool wasFound = iterator != kScenes.end();
  return wasFound ? static_cast<std::size_t>(iterator - kScenes.begin()) : 0;
}

} // namespace

Settings sanitizeSettings(Settings settings) {
  settings.gain = std::isfinite(settings.gain) ? std::clamp(settings.gain, 0.5F, 4.0F) : 1.5F;
  settings.fixedHue =
      std::isfinite(settings.fixedHue) ? std::clamp(settings.fixedHue, 0.0F, 360.0F) : 200.0F;
  settings.cycleSeconds = std::isfinite(settings.cycleSeconds)
                              ? std::clamp(settings.cycleSeconds, 2.0F, 600.0F)
                              : 30.0F;
  settings.cycleBars = std::clamp<std::uint16_t>(settings.cycleBars, 1, 256);
  settings.gachaBars = std::clamp<std::uint16_t>(settings.gachaBars, 1, 512);
  const std::size_t firstText = settings.seed.find_first_not_of(" \t\r\n");
  const std::size_t lastText = settings.seed.find_last_not_of(" \t\r\n");
  const bool hasSeed = firstText != std::string::npos && lastText != std::string::npos;
  settings.seed =
      hasSeed ? settings.seed.substr(firstText, lastText - firstText + 1) : "neon-prism-001";
  const bool isTooLong = settings.seed.size() > 64;
  if (isTooLong) {
    settings.seed.resize(64);
  }
  return settings;
}

const char* sceneId(SceneId scene) { return kSceneIds[sceneIndex(scene)]; }

const char* sceneName(SceneId scene) { return kSceneNames[sceneIndex(scene)]; }

SceneId sceneFromId(const std::string& id) {
  const auto iterator = std::find_if(kSceneIds.begin(), kSceneIds.end(),
                                     [&id](const char* candidate) { return id == candidate; });
  const bool wasFound = iterator != kSceneIds.end();
  return wasFound ? kScenes[static_cast<std::size_t>(iterator - kSceneIds.begin())] : SceneId::Bars;
}

SceneId shiftedScene(SceneId scene, int delta) {
  const int count = static_cast<int>(kScenes.size());
  const int current = static_cast<int>(sceneIndex(scene));
  const int shifted = ((current + delta) % count + count) % count;
  return kScenes[static_cast<std::size_t>(shifted)];
}

std::size_t sceneCount() { return kScenes.size(); }

} // namespace stackchan
