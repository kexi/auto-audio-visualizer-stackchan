#include "visualizer/runtime.hpp"
#include "visualizer/semantic_patch.hpp"

#include <algorithm>
#include <cmath>
#include <utility>

namespace stackchan {
namespace {

float interpolate(float from, float to, float progress) { return from + (to - from) * progress; }

float interpolateHue(float from, float to, float progress) {
  float difference = std::fmod(to - from + 540.0F, 360.0F) - 180.0F;
  const bool wrappedNegative = difference < -180.0F;
  if (wrappedNegative) {
    difference += 360.0F;
  }
  float hue = std::fmod(from + difference * progress, 360.0F);
  const bool isNegative = hue < 0.0F;
  if (isNegative) {
    hue += 360.0F;
  }
  return hue;
}

Variation blendVariation(const Variation& from, const Variation& to, float progress) {
  const float clampedProgress = std::clamp(progress, 0.0F, 1.0F);
  const bool usesTargetDiscreteValues = clampedProgress >= 0.5F;
  Variation output = usesTargetDiscreteValues ? to : from;
  output.hueOffset = interpolateHue(from.hueOffset, to.hueOffset, clampedProgress);
  output.hueSpread = interpolate(from.hueSpread, to.hueSpread, clampedProgress);
  output.saturation = interpolate(from.saturation, to.saturation, clampedProgress);
  output.lightness = interpolate(from.lightness, to.lightness, clampedProgress);
  output.speed = interpolate(from.speed, to.speed, clampedProgress);
  output.density = interpolate(from.density, to.density, clampedProgress);
  output.scale = interpolate(from.scale, to.scale, clampedProgress);
  output.wobble = interpolate(from.wobble, to.wobble, clampedProgress);
  output.shape = interpolate(from.shape, to.shape, clampedProgress);
  return output;
}

std::string patchSeed(const std::string& patchJson) {
  std::uint32_t hash = 2166136261U;
  for (const unsigned char byte : patchJson) {
    hash ^= byte;
    hash *= 16777619U;
  }
  constexpr char kHex[] = "0123456789abcdef";
  std::string seed = "patch-00000000";
  for (int index = 0; index < 8; ++index) {
    const int shift = (7 - index) * 4;
    seed[6 + static_cast<std::size_t>(index)] = kHex[(hash >> shift) & 0x0FU];
  }
  return seed;
}

float transitionDurationSeconds(const std::string& fromPatch, const std::string& toPatch,
                                const TransitionSpec& transition) {
  const bool changesTopology = semanticPatchTopology(fromPatch) != semanticPatchTopology(toPatch);
  const double milliseconds =
      changesTopology
          ? transition.topologyMs
          : std::max({transition.paletteMs, transition.parameterMs, transition.modulationMs});
  return static_cast<float>(std::clamp(milliseconds / 1000.0, 0.001, 30.0));
}

float easedProgress(float elapsedSeconds, double durationMs, TransitionEasing easing) {
  const float durationSeconds = static_cast<float>(std::max(0.0, durationMs) / 1000.0);
  const bool finishesImmediately = durationSeconds <= 0.0F;
  const float linearProgress =
      finishesImmediately ? 1.0F : std::clamp(elapsedSeconds / durationSeconds, 0.0F, 1.0F);
  const bool usesLinearEasing = easing == TransitionEasing::Linear;
  return usesLinearEasing ? linearProgress
                          : linearProgress * linearProgress * (3.0F - 2.0F * linearProgress);
}

} // namespace

RuntimeController::RuntimeController(Settings settings) { setSettings(std::move(settings)); }

RuntimeUpdate RuntimeController::update(const AnalyzedAudioFrame& audio, float deltaSeconds,
                                        std::uint32_t entropy) {
  RuntimeUpdate result{};
  const float safeDeltaSeconds = std::max(0.0F, deltaSeconds);
  qualityClockMs_ += static_cast<double>(safeDeltaSeconds) * 1000.0;
  quality_.update(safeDeltaSeconds * 1000.0F, qualityClockMs_);
  updateVariationTransition(deltaSeconds);
  secondsSinceSceneChange_ += std::max(0.0F, deltaSeconds);
  const bool usesSecondCycle = settings_.autoCycle && settings_.cycleMode == CycleMode::Seconds;
  const bool secondCycleDue = usesSecondCycle && secondsSinceSceneChange_ >= settings_.cycleSeconds;
  const bool usesBarCycle = settings_.autoCycle && settings_.cycleMode == CycleMode::Bars;
  const bool barCycleDue = usesBarCycle && audio.tempo.bpm > 0.0F &&
                           audio.tempo.barCount - lastSceneBar_ >= settings_.cycleBars;
  const bool shouldCycleScene = secondCycleDue || barCycleDue;
  if (shouldCycleScene) {
    shiftScene(1);
    secondsSinceSceneChange_ = 0.0F;
    lastSceneBar_ = audio.tempo.barCount;
    result.sceneChanged = true;
  }

  const bool gachaDue = settings_.autoGacha && audio.tempo.bpm > 0.0F &&
                        audio.tempo.barCount - lastGachaBar_ >= settings_.gachaBars;
  if (gachaDue) {
    reroll(entropy);
    lastGachaBar_ = audio.tempo.barCount;
    result.variationChanged = true;
  }
  return result;
}

void RuntimeController::setSettings(Settings settings) {
  const std::string previousSeed = settings_.seed;
  settings_ = sanitizeSettings(std::move(settings));
  const bool needsSemanticPatch = settings_.scene == SceneId::SemanticSynth &&
                                  (patchJson_.empty() || semanticPatchSeed_ != settings_.seed);
  if (needsSemanticPatch) {
    previousPatchJson_ = patchJson_;
    patchJson_ = deriveSemanticPatchJson(settings_.seed);
    semanticPatchSeed_ = settings_.seed;
  }
  const bool needsInitialVariation = variation_.seed.empty();
  if (needsInitialVariation) {
    variation_ = generateVariation(settings_.seed);
    previousVariation_ = variation_;
    renderedVariation_ = variation_;
    variationTransitionActive_ = false;
    return;
  }
  const bool didSeedChange = previousSeed != settings_.seed;
  if (didSeedChange) {
    patchTransitionSpec_ = {};
    patchTransitionUsesDecks_ =
        semanticPatchTopology(previousPatchJson_) != semanticPatchTopology(patchJson_);
    const float durationSeconds =
        transitionDurationSeconds(previousPatchJson_, patchJson_, patchTransitionSpec_);
    const bool changesPatch = previousPatchJson_ != patchJson_;
    startVariationTransition(settings_.seed, durationSeconds, patchTransitionSpec_.easing,
                             changesPatch);
  }
}

void RuntimeController::shiftScene(int delta) {
  settings_.scene = shiftedScene(settings_.scene, delta);
  const bool needsSemanticPatch = settings_.scene == SceneId::SemanticSynth &&
                                  (patchJson_.empty() || semanticPatchSeed_ != settings_.seed);
  if (needsSemanticPatch) {
    previousPatchJson_ = patchJson_;
    patchJson_ = deriveSemanticPatchJson(settings_.seed);
    semanticPatchSeed_ = settings_.seed;
  }
}

void RuntimeController::reroll(std::uint32_t entropy) {
  settings_.seed = generateReadableSeed(entropy);
  const bool updatesSemanticPatch = settings_.scene == SceneId::SemanticSynth;
  if (updatesSemanticPatch) {
    previousPatchJson_ = patchJson_;
    patchJson_ = deriveSemanticPatchJson(settings_.seed);
    semanticPatchSeed_ = settings_.seed;
  }
  patchTransitionSpec_ = {};
  patchTransitionUsesDecks_ =
      semanticPatchTopology(previousPatchJson_) != semanticPatchTopology(patchJson_);
  const float durationSeconds =
      transitionDurationSeconds(previousPatchJson_, patchJson_, patchTransitionSpec_);
  const bool changesPatch = previousPatchJson_ != patchJson_;
  startVariationTransition(settings_.seed, durationSeconds, patchTransitionSpec_.easing,
                           changesPatch);
}

bool RuntimeController::applySeed(const std::string& seed, const TransitionSpec& transition) {
  Settings nextSettings = settings_;
  nextSettings.scene = SceneId::SemanticSynth;
  nextSettings.seed = seed;
  settings_ = sanitizeSettings(std::move(nextSettings));
  previousPatchJson_ = patchJson_;
  patchJson_ = deriveSemanticPatchJson(seed);
  semanticPatchSeed_ = seed;
  const float durationSeconds =
      transitionDurationSeconds(previousPatchJson_, patchJson_, transition);
  patchTransitionSpec_ = transition;
  patchTransitionUsesDecks_ =
      semanticPatchTopology(previousPatchJson_) != semanticPatchTopology(patchJson_);
  const bool changesPatch = previousPatchJson_ != patchJson_;
  startVariationTransition(seed, durationSeconds, transition.easing, changesPatch);
  return true;
}

bool RuntimeController::applyIntent(const SemanticIntent& intent,
                                    const TransitionSpec& transition) {
  const bool hasPatch = !intent.patchJson.empty();
  const bool hasSeed = !intent.seed.empty();
  if (!hasPatch && !hasSeed) {
    return false;
  }
  if (!hasPatch) {
    return applySeed(intent.seed, transition);
  }
  previousPatchJson_ = patchJson_;
  patchJson_ = intent.patchJson;
  settings_.scene = SceneId::SemanticSynth;
  const std::string declaredSeed =
      hasSeed ? intent.seed
              : semanticPatchSeed(intent.patchJson).value_or(patchSeed(intent.patchJson));
  settings_.seed = declaredSeed;
  settings_ = sanitizeSettings(settings_);
  semanticPatchSeed_ = declaredSeed;
  const std::string& visualSeed = declaredSeed;
  const float durationSeconds =
      transitionDurationSeconds(previousPatchJson_, patchJson_, transition);
  patchTransitionSpec_ = transition;
  patchTransitionUsesDecks_ =
      semanticPatchTopology(previousPatchJson_) != semanticPatchTopology(patchJson_);
  const bool changesPatch = previousPatchJson_ != patchJson_;
  startVariationTransition(visualSeed, durationSeconds, transition.easing, changesPatch);
  return true;
}

void RuntimeController::startVariationTransition(const std::string& seed, float durationSeconds,
                                                 TransitionEasing easing, bool forceTransition) {
  previousVariation_ = renderedVariation_;
  variation_ = generateVariation(seed);
  variationTransitionSeconds_ = 0.0F;
  variationTransitionDurationSeconds_ = std::max(durationSeconds, 0.001F);
  variationTransitionEasing_ = easing;
  variationTransitionActive_ = forceTransition || previousVariation_.seed != variation_.seed;
  const bool isAlreadyAtTarget = !variationTransitionActive_;
  if (isAlreadyAtTarget) {
    renderedVariation_ = variation_;
  }
}

void RuntimeController::updateVariationTransition(float deltaSeconds) {
  if (!variationTransitionActive_) {
    return;
  }
  variationTransitionSeconds_ += std::max(0.0F, deltaSeconds);
  const float progress = variationTransitionSeconds_ / variationTransitionDurationSeconds_;
  const float clampedProgress = std::clamp(progress, 0.0F, 1.0F);
  const float blendProgress =
      variationTransitionEasing_ == TransitionEasing::Linear
          ? clampedProgress
          : clampedProgress * clampedProgress * (3.0F - 2.0F * clampedProgress);
  renderedVariation_ = blendVariation(previousVariation_, variation_, blendProgress);
  const bool didFinish = progress >= 1.0F;
  if (didFinish) {
    renderedVariation_ = variation_;
    variationTransitionActive_ = false;
  }
}

const Settings& RuntimeController::settings() const { return settings_; }

const Variation& RuntimeController::variation() const { return renderedVariation_; }

const std::string& RuntimeController::patchJson() const { return patchJson_; }

const std::string& RuntimeController::previousPatchJson() const { return previousPatchJson_; }

float RuntimeController::transitionProgress() const {
  const bool hasActiveTransition = variationTransitionActive_;
  if (!hasActiveTransition) {
    return 1.0F;
  }
  const float progress = variationTransitionSeconds_ / variationTransitionDurationSeconds_;
  const float clampedProgress = std::clamp(progress, 0.0F, 1.0F);
  return variationTransitionEasing_ == TransitionEasing::Linear
             ? clampedProgress
             : clampedProgress * clampedProgress * (3.0F - 2.0F * clampedProgress);
}

PatchTransitionProgress RuntimeController::patchTransitionProgress() const {
  const bool hasActiveTransition = variationTransitionActive_;
  if (!hasActiveTransition) {
    return {};
  }
  return {
      easedProgress(variationTransitionSeconds_, patchTransitionSpec_.paletteMs,
                    patchTransitionSpec_.easing),
      easedProgress(variationTransitionSeconds_, patchTransitionSpec_.parameterMs,
                    patchTransitionSpec_.easing),
      easedProgress(variationTransitionSeconds_, patchTransitionSpec_.modulationMs,
                    patchTransitionSpec_.easing),
      easedProgress(variationTransitionSeconds_, patchTransitionSpec_.topologyMs,
                    patchTransitionSpec_.easing),
      patchTransitionUsesDecks_,
  };
}

bool RuntimeController::variationTransitionActive() const { return variationTransitionActive_; }

float RuntimeController::qualityScale() const { return quality_.scale(); }

} // namespace stackchan
