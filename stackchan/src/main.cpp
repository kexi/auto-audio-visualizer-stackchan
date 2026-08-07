#include <M5Unified.h>

#include <array>
#include <cmath>
#include <cstdint>

#include "visualizer/visualizer.hpp"

namespace {

constexpr std::uint32_t kSampleRate = 16000;
std::array<std::int16_t, 256> samples{};
stackchan::Visualizer visualizer;
std::uint32_t previousMillis = 0;

stackchan::AudioFrame readAudio() {
  const bool didRecord = M5.Mic.record(samples.data(), samples.size(), kSampleRate);
  if (!didRecord) {
    return {};
  }

  double energy = 0.0;
  for (const std::int16_t sample : samples) {
    const double normalized = static_cast<double>(sample) / 32768.0;
    energy += normalized * normalized;
  }
  const float rootMeanSquare = static_cast<float>(std::sqrt(energy / samples.size()));
  const float level = std::min(rootMeanSquare * 8.0F, 1.0F);
  return {level, level, level * 0.8F, level * 0.55F};
}

void render(const stackchan::VisualizerState& state) {
  auto& display = M5.Display;
  display.startWrite();
  display.fillScreen(TFT_BLACK);
  const int eyeHeight = std::max(3, 18 - static_cast<int>(state.eyeSquint * 14.0F));
  display.fillRoundRect(76, 70 + (18 - eyeHeight) / 2, 52, eyeHeight, eyeHeight / 2, TFT_CYAN);
  display.fillRoundRect(192, 70 + (18 - eyeHeight) / 2, 52, eyeHeight, eyeHeight / 2, TFT_CYAN);

  const int mouthHeight = 4 + static_cast<int>(state.mouthOpen * 42.0F);
  display.drawRoundRect(135, 116, 50, mouthHeight, 8, TFT_CYAN);
  for (std::size_t index = 0; index < state.bars.size(); ++index) {
    const int barHeight = 4 + static_cast<int>(state.bars[index] * 62.0F);
    display.fillRect(21 + static_cast<int>(index) * 24, 224 - barHeight, 18, barHeight, TFT_CYAN);
  }
  display.endWrite();
}

} // namespace

void setup() {
  auto config = M5.config();
  config.internal_mic = true;
  M5.begin(config);
  M5.Display.setRotation(1);

  auto micConfig = M5.Mic.config();
  micConfig.sample_rate = kSampleRate;
  M5.Mic.config(micConfig);
  M5.Mic.begin();
  previousMillis = millis();
}

void loop() {
  M5.update();
  const std::uint32_t currentMillis = millis();
  const float deltaSeconds = static_cast<float>(currentMillis - previousMillis) / 1000.0F;
  previousMillis = currentMillis;
  visualizer.update(readAudio(), deltaSeconds);
  render(visualizer.state());
}
