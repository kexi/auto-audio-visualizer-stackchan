#pragma once

#include "visualizer/audio.hpp"
#include "visualizer/settings.hpp"
#include "visualizer/timeline.hpp"
#include "visualizer/variation.hpp"

#include <cstdint>

namespace stackchan {

struct RuntimeUpdate {
  bool sceneChanged = false;
  bool variationChanged = false;
};

class RuntimeController {
public:
  explicit RuntimeController(Settings settings = {});

  RuntimeUpdate update(const AnalyzedAudioFrame& audio, float deltaSeconds, std::uint32_t entropy);
  void setSettings(Settings settings);
  void shiftScene(int delta);
  void reroll(std::uint32_t entropy);
  bool applyIntent(const SemanticIntent& intent, const TransitionSpec& transition);
  [[nodiscard]] const Settings& settings() const;
  [[nodiscard]] const Variation& variation() const;
  [[nodiscard]] const std::string& patchJson() const;
  [[nodiscard]] bool variationTransitionActive() const;

private:
  void startVariationTransition(const std::string& seed, float durationSeconds = 1.2F,
                                TransitionEasing easing = TransitionEasing::EaseInOut);
  void updateVariationTransition(float deltaSeconds);

  Settings settings_{};
  Variation variation_{};
  Variation previousVariation_{};
  Variation renderedVariation_{};
  float variationTransitionSeconds_ = 0.0F;
  float variationTransitionDurationSeconds_ = 1.2F;
  TransitionEasing variationTransitionEasing_ = TransitionEasing::EaseInOut;
  bool variationTransitionActive_ = false;
  std::string patchJson_;
  float secondsSinceSceneChange_ = 0.0F;
  std::uint32_t lastSceneBar_ = 0;
  std::uint32_t lastGachaBar_ = 0;
};

} // namespace stackchan
