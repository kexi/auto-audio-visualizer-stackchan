#pragma once

#include "visualizer/audio.hpp"
#include "visualizer/settings.hpp"
#include "visualizer/variation.hpp"

#include <cstdint>
#include <string>

namespace stackchan {

struct Color {
  std::uint8_t red = 0;
  std::uint8_t green = 0;
  std::uint8_t blue = 0;
  std::uint8_t alpha = 255;
};

class Canvas {
public:
  virtual ~Canvas() = default;
  [[nodiscard]] virtual int width() const = 0;
  [[nodiscard]] virtual int height() const = 0;
  virtual void clear(Color color) = 0;
  virtual void line(int x1, int y1, int x2, int y2, Color color, int thickness = 1) = 0;
  virtual void rectangle(int x, int y, int width, int height, Color color, bool filled) = 0;
  virtual void circle(int x, int y, int radius, Color color, bool filled) = 0;
  virtual void text(int x, int y, const std::string& value, Color color) = 0;
};

[[nodiscard]] Color hsl(float hue, float saturation, float lightness, std::uint8_t alpha = 255);

class SceneRenderer {
public:
  void draw(Canvas& canvas, SceneId scene, const AnalyzedAudioFrame& audio,
            const Variation& variation, float elapsedSeconds, float deltaSeconds, float baseHue);

private:
  void drawBars(Canvas& canvas, const AnalyzedAudioFrame& audio, const Variation& variation,
                float hue);
  void drawWaveform(Canvas& canvas, const AnalyzedAudioFrame& audio, const Variation& variation,
                    float elapsedSeconds, float hue);
  void drawParticles(Canvas& canvas, const AnalyzedAudioFrame& audio, const Variation& variation,
                     float elapsedSeconds, float hue);
  void drawRadial(Canvas& canvas, const AnalyzedAudioFrame& audio, const Variation& variation,
                  float elapsedSeconds, float hue);
  void drawRings(Canvas& canvas, const AnalyzedAudioFrame& audio, const Variation& variation,
                 float elapsedSeconds, float hue);
  void drawLissajous(Canvas& canvas, const AnalyzedAudioFrame& audio, const Variation& variation,
                     float elapsedSeconds, float hue);
  void drawFluid(Canvas& canvas, const AnalyzedAudioFrame& audio, const Variation& variation,
                 float elapsedSeconds, float hue);
  void drawSmoke(Canvas& canvas, const AnalyzedAudioFrame& audio, const Variation& variation,
                 float elapsedSeconds, float hue);
  void drawLava(Canvas& canvas, const AnalyzedAudioFrame& audio, const Variation& variation,
                float elapsedSeconds, float hue);
  void drawAurora(Canvas& canvas, const AnalyzedAudioFrame& audio, const Variation& variation,
                  float elapsedSeconds, float hue);
  void drawSemanticSynth(Canvas& canvas, const AnalyzedAudioFrame& audio,
                         const Variation& variation, float elapsedSeconds, float hue);
};

} // namespace stackchan
