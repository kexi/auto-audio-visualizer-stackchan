#pragma once

#include "visualizer/audio.hpp"
#include "visualizer/quality.hpp"
#include "visualizer/settings.hpp"
#include "visualizer/timeline.hpp"
#include "visualizer/variation.hpp"

#include <cstdint>

namespace stackchan {

struct RuntimeUpdate {
  bool sceneChanged = false;
  bool variationChanged = false;
};

struct PatchTransitionProgress {
  float palette = 1.0F;
  float parameter = 1.0F;
  float modulation = 1.0F;
  float topology = 1.0F;
  bool usesDecks = false;
};

class RuntimeController {
public:
  explicit RuntimeController(Settings settings = {});

  RuntimeUpdate update(const AnalyzedAudioFrame& audio, float deltaSeconds, std::uint32_t entropy);
  void setSettings(Settings settings);
  void shiftScene(int delta);
  void reroll(std::uint32_t entropy);
  bool applySeed(const std::string& seed, const TransitionSpec& transition = {});
  bool applyIntent(const SemanticIntent& intent, const TransitionSpec& transition);
  [[nodiscard]] const Settings& settings() const;
  [[nodiscard]] const Variation& variation() const;
  [[nodiscard]] const std::string& patchJson() const;
  [[nodiscard]] const std::string& previousPatchJson() const;
  [[nodiscard]] float transitionProgress() const;
  [[nodiscard]] PatchTransitionProgress patchTransitionProgress() const;
  [[nodiscard]] bool variationTransitionActive() const;
  [[nodiscard]] float qualityScale() const;

private:
  void startVariationTransition(const std::string& seed, float durationSeconds = 1.2F,
                                TransitionEasing easing = TransitionEasing::EaseInOut,
                                bool forceTransition = false);
  void updateVariationTransition(float deltaSeconds);

  Settings settings_{};
  Variation variation_{};
  Variation previousVariation_{};
  Variation renderedVariation_{};
  float variationTransitionSeconds_ = 0.0F;
  float variationTransitionDurationSeconds_ = 1.2F;
  TransitionEasing variationTransitionEasing_ = TransitionEasing::EaseInOut;
  TransitionSpec patchTransitionSpec_{};
  bool patchTransitionUsesDecks_ = false;
  bool variationTransitionActive_ = false;
  std::string patchJson_;
  std::string previousPatchJson_;
  std::string semanticPatchSeed_;
  float secondsSinceSceneChange_ = 0.0F;
  std::uint32_t lastSceneBar_ = 0;
  std::uint32_t lastGachaBar_ = 0;
  QualityController quality_{};
  double qualityClockMs_ = 0.0;
};

} // namespace stackchan
