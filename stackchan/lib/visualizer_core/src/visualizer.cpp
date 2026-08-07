#include "visualizer/visualizer.hpp"

#include <algorithm>
#include <cmath>

namespace stackchan {
namespace {

float clampUnit(float value) { return std::clamp(value, 0.0F, 1.0F); }

float smooth(float current, float target, float deltaSeconds, float attack, float release) {
  const bool isRising = target > current;
  const float timeConstant = isRising ? attack : release;
  const float safeDelta = std::max(deltaSeconds, 0.0F);
  const float factor = 1.0F - std::exp(-safeDelta / timeConstant);
  return current + ((target - current) * factor);
}

} // namespace

void Visualizer::update(const AudioFrame& audio, float deltaSeconds) {
  const float level = clampUnit(audio.level);
  const float bass = clampUnit(audio.bass);
  const float mid = clampUnit(audio.mid);
  const float treble = clampUnit(audio.treble);

  phase_ += std::max(deltaSeconds, 0.0F) * (1.2F + bass * 3.0F);
  for (std::size_t index = 0; index < state_.bars.size(); ++index) {
    const float position = static_cast<float>(index) / static_cast<float>(state_.bars.size());
    const float wave = 0.5F + 0.5F * std::sin(phase_ + position * 9.0F);
    const float frequencyBias = bass * (1.0F - position) + treble * position;
    const float target = clampUnit(level * 0.45F + frequencyBias * 0.35F + wave * mid * 0.2F);
    state_.bars[index] = smooth(state_.bars[index], target, deltaSeconds, 0.045F, 0.22F);
  }

  state_.mouthOpen = smooth(state_.mouthOpen, level, deltaSeconds, 0.035F, 0.16F);
  state_.eyeSquint = smooth(state_.eyeSquint, bass * 0.75F, deltaSeconds, 0.08F, 0.3F);
  state_.hue = std::fmod(state_.hue + deltaSeconds * (4.0F + treble * 18.0F), 360.0F);
}

const VisualizerState& Visualizer::state() const { return state_; }

} // namespace stackchan
