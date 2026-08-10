#include "visualizer/headbang.hpp"

#include <algorithm>
#include <cmath>

namespace stackchan {
namespace {

constexpr int kCenterPitch = 350;
constexpr int kCenteringSpeed = 400;
constexpr float kMinimumExcursion = 140.0F;
constexpr float kAdditionalExcursion = 210.0F;
constexpr float kMinimumSpeed = 600.0F;
constexpr float kAdditionalSpeed = 350.0F;

} // namespace

HeadbangCommand HeadbangController::update(const TempoState& tempo, float beatIntensity) {
  const bool justLostTempoLock = wasTempoLocked_ && !tempo.locked;
  wasTempoLocked_ = tempo.locked;
  if (justLostTempoLock) {
    hasLastBeat_ = false;
    return {true, 0, kCenterPitch, kCenteringSpeed};
  }

  const bool hasLockedBeat = tempo.locked && tempo.gridBeat;
  if (!hasLockedBeat) {
    return {};
  }

  const std::uint64_t beatNumber =
      static_cast<std::uint64_t>(tempo.barCount) * 4U + static_cast<std::uint64_t>(tempo.beatInBar);
  const bool alreadyHandledBeat = hasLastBeat_ && beatNumber == lastBeatNumber_;
  if (alreadyHandledBeat) {
    return {};
  }
  lastBeatNumber_ = beatNumber;
  hasLastBeat_ = true;

  const float intensity = std::clamp(beatIntensity, 0.0F, 1.0F);
  const int excursion =
      static_cast<int>(std::round(kMinimumExcursion + intensity * kAdditionalExcursion));
  const bool movesDown = beatNumber % 2U == 1U;
  const int pitch = kCenterPitch + (movesDown ? -excursion : excursion);
  const int speed = static_cast<int>(std::round(kMinimumSpeed + intensity * kAdditionalSpeed));
  return {true, 0, pitch, speed};
}

} // namespace stackchan
