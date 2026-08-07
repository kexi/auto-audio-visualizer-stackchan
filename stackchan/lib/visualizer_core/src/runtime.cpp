#include "visualizer/runtime.hpp"

#include <algorithm>
#include <cmath>
#include <utility>

namespace stackchan {
namespace {

constexpr float kVariationTransitionDurationSeconds = 1.2F;

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
  const float clamped = std::clamp(progress, 0.0F, 1.0F);
  const float eased = clamped * clamped * (3.0F - 2.0F * clamped);
  const bool usesTargetDiscreteValues = eased >= 0.5F;
  Variation output = usesTargetDiscreteValues ? to : from;
  output.hueOffset = interpolateHue(from.hueOffset, to.hueOffset, eased);
  output.hueSpread = interpolate(from.hueSpread, to.hueSpread, eased);
  output.saturation = interpolate(from.saturation, to.saturation, eased);
  output.lightness = interpolate(from.lightness, to.lightness, eased);
  output.speed = interpolate(from.speed, to.speed, eased);
  output.density = interpolate(from.density, to.density, eased);
  output.scale = interpolate(from.scale, to.scale, eased);
  output.wobble = interpolate(from.wobble, to.wobble, eased);
  output.shape = interpolate(from.shape, to.shape, eased);
  return output;
}

} // namespace

RuntimeController::RuntimeController(Settings settings) { setSettings(settings); }

RuntimeUpdate RuntimeController::update(const AnalyzedAudioFrame& audio, float deltaSeconds,
                                        std::uint32_t entropy) {
  RuntimeUpdate result{};
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
    startVariationTransition(settings_.seed);
  }
}

void RuntimeController::shiftScene(int delta) {
  settings_.scene = shiftedScene(settings_.scene, delta);
}

void RuntimeController::reroll(std::uint32_t entropy) {
  settings_.seed = generateReadableSeed(entropy);
  startVariationTransition(settings_.seed);
}

void RuntimeController::startVariationTransition(const std::string& seed) {
  previousVariation_ = renderedVariation_;
  variation_ = generateVariation(seed);
  variationTransitionSeconds_ = 0.0F;
  variationTransitionActive_ = previousVariation_.seed != variation_.seed;
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
  const float progress = variationTransitionSeconds_ / kVariationTransitionDurationSeconds;
  renderedVariation_ = blendVariation(previousVariation_, variation_, progress);
  const bool didFinish = progress >= 1.0F;
  if (didFinish) {
    renderedVariation_ = variation_;
    variationTransitionActive_ = false;
  }
}

const Settings& RuntimeController::settings() const { return settings_; }

const Variation& RuntimeController::variation() const { return renderedVariation_; }

bool RuntimeController::variationTransitionActive() const { return variationTransitionActive_; }

} // namespace stackchan
