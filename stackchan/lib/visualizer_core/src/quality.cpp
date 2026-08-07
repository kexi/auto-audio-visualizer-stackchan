#include "visualizer/quality.hpp"

#include <algorithm>
#include <cmath>

namespace stackchan {
namespace {

constexpr float kEwmaTauMs = 500.0F;

} // namespace

QualityController::QualityController(QualityOptions options) : options_(options) {}

float QualityController::update(float frameMs, double nowMs) {
  const float safeFrameMs = std::max(0.0F, frameMs);
  const bool needsInitialSample = !hasSmoothedValue_;
  if (needsInitialSample) {
    smoothedMs_ = safeFrameMs;
    hasSmoothedValue_ = true;
  } else {
    const float blend = 1.0F - std::exp(-safeFrameMs / kEwmaTauMs);
    smoothedMs_ += blend * (safeFrameMs - smoothedMs_);
  }

  const bool shouldDegrade = smoothedMs_ > options_.degradeAboveMs;
  if (shouldDegrade) {
    const bool needsDegradeStart = !hasDegradeStart_;
    if (needsDegradeStart) {
      degradeSinceMs_ = nowMs;
      hasDegradeStart_ = true;
    }
  } else {
    hasDegradeStart_ = false;
  }

  const bool shouldRecover = smoothedMs_ < options_.recoverBelowMs;
  if (shouldRecover) {
    const bool needsRecoverStart = !hasRecoverStart_;
    if (needsRecoverStart) {
      recoverSinceMs_ = nowMs;
      hasRecoverStart_ = true;
    }
  } else {
    hasRecoverStart_ = false;
  }

  const bool isCoolingDown =
      hasLastChange_ && nowMs - lastChangeMs_ < static_cast<double>(options_.cooldownMs);
  if (isCoolingDown) {
    return scale();
  }

  const bool sustainedDegrade = hasDegradeStart_ && nowMs - degradeSinceMs_ >= options_.sustainMs &&
                                index_ + 1U < options_.scales.size();
  const bool sustainedRecovery =
      hasRecoverStart_ && nowMs - recoverSinceMs_ >= options_.sustainMs && index_ > 0U;
  if (sustainedDegrade) {
    ++index_;
  } else if (sustainedRecovery) {
    --index_;
  } else {
    return scale();
  }

  lastChangeMs_ = nowMs;
  hasLastChange_ = true;
  hasDegradeStart_ = false;
  hasRecoverStart_ = false;
  return scale();
}

float QualityController::scale() const { return options_.scales[index_]; }

void QualityController::reset() {
  index_ = 0;
  smoothedMs_ = 0.0F;
  hasSmoothedValue_ = false;
  hasDegradeStart_ = false;
  hasRecoverStart_ = false;
  hasLastChange_ = false;
}

} // namespace stackchan
