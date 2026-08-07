#pragma once

#include <array>
#include <cstddef>

namespace stackchan {

struct QualityOptions {
  std::array<float, 3> scales{1.0F, 0.75F, 0.5F};
  float degradeAboveMs = 22.0F;
  float recoverBelowMs = 13.0F;
  float sustainMs = 2000.0F;
  float cooldownMs = 4000.0F;
};

class QualityController {
public:
  explicit QualityController(QualityOptions options = {});

  float update(float frameMs, double nowMs);
  [[nodiscard]] float scale() const;
  void reset();

private:
  QualityOptions options_{};
  std::size_t index_ = 0;
  float smoothedMs_ = 0.0F;
  bool hasSmoothedValue_ = false;
  double degradeSinceMs_ = 0.0;
  double recoverSinceMs_ = 0.0;
  double lastChangeMs_ = 0.0;
  bool hasDegradeStart_ = false;
  bool hasRecoverStart_ = false;
  bool hasLastChange_ = false;
};

} // namespace stackchan
