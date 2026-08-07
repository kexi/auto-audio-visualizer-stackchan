#pragma once

#include <array>
#include <cstddef>

namespace stackchan {

constexpr std::size_t kBarCount = 12;

struct AudioFrame {
  float level = 0.0F;
  float bass = 0.0F;
  float mid = 0.0F;
  float treble = 0.0F;
};

struct VisualizerState {
  std::array<float, kBarCount> bars{};
  float mouthOpen = 0.0F;
  float eyeSquint = 0.0F;
  float hue = 190.0F;
};

class Visualizer {
public:
  void update(const AudioFrame& audio, float deltaSeconds);
  [[nodiscard]] const VisualizerState& state() const;

private:
  VisualizerState state_{};
  float phase_ = 0.0F;
};

} // namespace stackchan
