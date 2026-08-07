#include "visualizer/scene_renderer.hpp"

#include <algorithm>
#include <cmath>

namespace stackchan {
namespace {

constexpr float kPi = 3.14159265358979323846F;

float clampUnit(float value) { return std::clamp(value, 0.0F, 1.0F); }

float wrapHue(float hue) {
  float wrapped = std::fmod(hue, 360.0F);
  const bool isNegative = wrapped < 0.0F;
  if (isNegative) {
    wrapped += 360.0F;
  }
  return wrapped;
}

Color sceneColor(const Variation& variation, float hue, float offset, float lightness,
                 std::uint8_t alpha = 255) {
  return hsl(hue + offset, variation.saturation, lightness, alpha);
}

int scaled(float value) { return static_cast<int>(std::round(value)); }

} // namespace

Color hsl(float hue, float saturation, float lightness, std::uint8_t alpha) {
  const float normalizedHue = wrapHue(hue) / 360.0F;
  const float normalizedSaturation = clampUnit(saturation / 100.0F);
  const float normalizedLightness = clampUnit(lightness / 100.0F);
  const float chroma = (1.0F - std::abs(2.0F * normalizedLightness - 1.0F)) * normalizedSaturation;
  const float sector = normalizedHue * 6.0F;
  const float secondary = chroma * (1.0F - std::abs(std::fmod(sector, 2.0F) - 1.0F));
  float red = 0.0F;
  float green = 0.0F;
  float blue = 0.0F;
  const int sectorIndex = static_cast<int>(sector) % 6;
  switch (sectorIndex) {
  case 0:
    red = chroma;
    green = secondary;
    break;
  case 1:
    red = secondary;
    green = chroma;
    break;
  case 2:
    green = chroma;
    blue = secondary;
    break;
  case 3:
    green = secondary;
    blue = chroma;
    break;
  case 4:
    red = secondary;
    blue = chroma;
    break;
  case 5:
    red = chroma;
    blue = secondary;
    break;
  }
  const float match = normalizedLightness - chroma * 0.5F;
  return {
      static_cast<std::uint8_t>(clampUnit(red + match) * 255.0F),
      static_cast<std::uint8_t>(clampUnit(green + match) * 255.0F),
      static_cast<std::uint8_t>(clampUnit(blue + match) * 255.0F),
      alpha,
  };
}

void SceneRenderer::draw(Canvas& canvas, SceneId scene, const AnalyzedAudioFrame& audio,
                         const Variation& variation, float elapsedSeconds, float deltaSeconds,
                         float baseHue) {
  static_cast<void>(deltaSeconds);
  canvas.clear({0, 0, 0, 255});
  const float hue = wrapHue(baseHue + variation.hueOffset);
  switch (scene) {
  case SceneId::Bars:
    drawBars(canvas, audio, variation, hue);
    break;
  case SceneId::Waveform:
    drawWaveform(canvas, audio, variation, elapsedSeconds, hue);
    break;
  case SceneId::Particles:
    drawParticles(canvas, audio, variation, elapsedSeconds, hue);
    break;
  case SceneId::Radial:
    drawRadial(canvas, audio, variation, elapsedSeconds, hue);
    break;
  case SceneId::Rings:
    drawRings(canvas, audio, variation, elapsedSeconds, hue);
    break;
  case SceneId::Lissajous:
    drawLissajous(canvas, audio, variation, elapsedSeconds, hue);
    break;
  case SceneId::Fluid:
    drawFluid(canvas, audio, variation, elapsedSeconds, hue);
    break;
  case SceneId::Smoke:
    drawSmoke(canvas, audio, variation, elapsedSeconds, hue);
    break;
  case SceneId::Lava:
    drawLava(canvas, audio, variation, elapsedSeconds, hue);
    break;
  case SceneId::Aurora:
    drawAurora(canvas, audio, variation, elapsedSeconds, hue);
    break;
  case SceneId::SemanticSynth:
    drawSemanticSynth(canvas, audio, variation, elapsedSeconds, hue);
    break;
  }
}

void SceneRenderer::drawBars(Canvas& canvas, const AnalyzedAudioFrame& audio,
                             const Variation& variation, float hue) {
  const int count = std::clamp(scaled(16.0F * variation.density), 8, 32);
  const float width = static_cast<float>(canvas.width()) / count;
  const bool usesBottomBars = variation.variant == 0;
  const bool usesCenteredBars = variation.variant == 1;
  const bool usesSplitBars = variation.variant == 2;
  for (int index = 0; index < count; ++index) {
    const std::size_t bin =
        static_cast<std::size_t>(index) * audio.spectrum.size() / static_cast<std::size_t>(count);
    const float energy = clampUnit(audio.spectrum[bin] * 2.8F + audio.level * 0.3F);
    const int barHeight = scaled((12.0F + energy * (canvas.height() - 24.0F)) * variation.scale);
    const float hueOffset = static_cast<float>(index) / count * variation.hueSpread;
    const Color color = sceneColor(variation, hue, hueOffset, 48.0F + energy * 25.0F);
    const int barWidth = std::max(2, scaled(width) - 2);
    const int x = scaled(index * width) + 1;
    if (usesBottomBars) {
      canvas.rectangle(x, canvas.height() - barHeight, barWidth, barHeight, color, true);
    } else if (usesCenteredBars) {
      canvas.rectangle(x, canvas.height() / 2 - barHeight / 2, barWidth, barHeight, color, true);
    } else if (usesSplitBars) {
      canvas.rectangle(x, 0, barWidth, barHeight / 2, color, true);
      canvas.rectangle(x, canvas.height() - barHeight / 2, barWidth, barHeight / 2, color, true);
    } else {
      const int y = index * canvas.height() / count;
      const int halfWidth = scaled(energy * canvas.width() * 0.45F);
      canvas.rectangle(0, y, halfWidth, std::max(2, canvas.height() / count - 2), color, true);
      canvas.rectangle(canvas.width() - halfWidth, y, halfWidth,
                       std::max(2, canvas.height() / count - 2), color, true);
    }
  }
}

void SceneRenderer::drawWaveform(Canvas& canvas, const AnalyzedAudioFrame& audio,
                                 const Variation& variation, float elapsedSeconds, float hue) {
  const bool usesLayeredWaveform = variation.variant == 1;
  const bool usesRadialWaveform = variation.variant == 2;
  const bool usesVerticalWaveform = variation.variant == 3;
  const int layers = usesLayeredWaveform ? 3 : 1;
  for (int layer = 0; layer < layers; ++layer) {
    const Color color = sceneColor(variation, hue, layer * variation.hueSpread / layers,
                                   variation.lightness + 12.0F);
    int previousX = 0;
    int previousY = canvas.height() / 2;
    for (std::size_t index = 0; index < audio.waveform.size(); ++index) {
      const float sample = audio.waveform[index];
      const float unit = static_cast<float>(index) / static_cast<float>(audio.waveform.size() - 1);
      int x = scaled(unit * (canvas.width() - 1));
      int y = canvas.height() / 2 + scaled(sample * canvas.height() * 0.42F * variation.scale);
      if (usesLayeredWaveform) {
        y = (layer + 1) * canvas.height() / 4 + scaled(sample * canvas.height() * 0.1F);
      } else if (usesRadialWaveform) {
        const float angle = unit * 2.0F * kPi;
        const float radius = canvas.height() * 0.23F + sample * canvas.height() * 0.16F;
        x = canvas.width() / 2 + scaled(std::cos(angle) * radius);
        y = canvas.height() / 2 + scaled(std::sin(angle) * radius);
      } else if (usesVerticalWaveform) {
        x = canvas.width() / 2 + scaled(sample * canvas.width() * 0.38F);
        y = scaled(unit * canvas.height());
      }
      const bool hasPrevious = index > 0;
      if (hasPrevious) {
        canvas.line(previousX, previousY, x, y, color, 2);
      }
      previousX = x;
      previousY = y;
    }
  }
  const bool showBeat = audio.beat || audio.tempo.gridBeat;
  if (showBeat) {
    canvas.circle(canvas.width() / 2, canvas.height() / 2,
                  scaled(8.0F + audio.beatIntensity * 18.0F),
                  sceneColor(variation, hue, elapsedSeconds * 20.0F, 80.0F), false);
  }
}

void SceneRenderer::drawParticles(Canvas& canvas, const AnalyzedAudioFrame& audio,
                                  const Variation& variation, float elapsedSeconds, float hue) {
  const int count = std::clamp(scaled(44.0F * variation.density), 20, 100);
  const bool usesRisingParticles = variation.variant == 0;
  const bool usesOrbitingParticles = variation.variant == 1;
  const bool usesRainParticles = variation.variant == 2;
  for (int index = 0; index < count; ++index) {
    const float randomX = variation.random(static_cast<std::uint32_t>(index * 3));
    const float randomY = variation.random(static_cast<std::uint32_t>(index * 3 + 1));
    const float randomSize = variation.random(static_cast<std::uint32_t>(index * 3 + 2));
    float x = randomX * canvas.width();
    float y = randomY * canvas.height();
    const float speed = (15.0F + randomSize * 45.0F) * variation.speed;
    if (usesRisingParticles) {
      y = std::fmod(y - elapsedSeconds * speed + canvas.height() * 20.0F,
                    static_cast<float>(canvas.height()));
    } else if (usesOrbitingParticles) {
      const float angle = randomX * 2.0F * kPi + elapsedSeconds * variation.direction * 0.5F;
      const float radius = randomY * canvas.height() * 0.46F;
      x = canvas.width() / 2.0F + std::cos(angle) * radius;
      y = canvas.height() / 2.0F + std::sin(angle) * radius;
    } else if (usesRainParticles) {
      y = std::fmod(y + elapsedSeconds * speed, static_cast<float>(canvas.height()));
      x += std::sin(elapsedSeconds + index) * audio.bass * 18.0F;
    } else {
      const float depth = std::fmod(randomY + elapsedSeconds * 0.18F * variation.speed, 1.0F);
      x = canvas.width() / 2.0F + (randomX - 0.5F) * canvas.width() * depth;
      y = canvas.height() / 2.0F +
          (variation.random(static_cast<std::uint32_t>(index + 700)) - 0.5F) * canvas.height() *
              depth;
    }
    const int radius =
        std::max(1, scaled((1.5F + randomSize * 3.5F + audio.treble * 3.0F) * variation.scale));
    const Color color = sceneColor(variation, hue, randomX * variation.hueSpread,
                                   variation.lightness + audio.level * 20.0F);
    canvas.circle(scaled(x), scaled(y), radius, color, true);
  }
}

void SceneRenderer::drawRadial(Canvas& canvas, const AnalyzedAudioFrame& audio,
                               const Variation& variation, float elapsedSeconds, float hue) {
  const int centerX = canvas.width() / 2;
  const int centerY = canvas.height() / 2;
  const int count = std::clamp(variation.symmetry * 8, 16, 64);
  const float rotation = elapsedSeconds * variation.speed * variation.direction * 0.35F;
  for (int index = 0; index < count; ++index) {
    const float angle = static_cast<float>(index) / count * 2.0F * kPi + rotation;
    const std::size_t bin =
        static_cast<std::size_t>(index) * audio.spectrum.size() / static_cast<std::size_t>(count);
    const float energy = clampUnit(audio.spectrum[bin] * 3.0F + audio.bass * 0.2F);
    const float inner = variation.variant == 2 ? 8.0F : 22.0F + variation.variant * 8.0F;
    const float outer = inner + 18.0F + energy * canvas.height() * 0.34F;
    const Color color =
        sceneColor(variation, hue, static_cast<float>(index) / count * variation.hueSpread,
                   variation.lightness + energy * 20.0F);
    canvas.line(centerX + scaled(std::cos(angle) * inner),
                centerY + scaled(std::sin(angle) * inner),
                centerX + scaled(std::cos(angle) * outer),
                centerY + scaled(std::sin(angle) * outer), color, variation.variant == 3 ? 3 : 1);
  }
}

void SceneRenderer::drawRings(Canvas& canvas, const AnalyzedAudioFrame& audio,
                              const Variation& variation, float elapsedSeconds, float hue) {
  const int count = std::clamp(scaled(7.0F * variation.density), 4, 14);
  const bool usesHorizontalDrift = variation.variant == 1;
  const bool usesTwinCenters = variation.variant == 2;
  const bool usesVerticalDrift = variation.variant == 3;
  for (int index = 0; index < count; ++index) {
    const float phase = std::fmod(
        elapsedSeconds * variation.speed * 0.22F + static_cast<float>(index) / count, 1.0F);
    const int radius = scaled(phase * canvas.height() * 0.62F * variation.scale);
    int x = canvas.width() / 2;
    int y = canvas.height() / 2;
    if (usesHorizontalDrift) {
      x += scaled(std::sin(elapsedSeconds + index) * canvas.width() * 0.18F);
    } else if (usesTwinCenters) {
      x = index % 2 == 0 ? canvas.width() / 3 : canvas.width() * 2 / 3;
    } else if (usesVerticalDrift) {
      y += scaled(std::cos(elapsedSeconds * 0.7F + index) * canvas.height() * 0.2F);
    }
    const Color color = sceneColor(variation, hue, phase * variation.hueSpread,
                                   variation.lightness + audio.beatIntensity * 24.0F);
    canvas.circle(x, y, std::max(2, radius), color, false);
  }
}

void SceneRenderer::drawLissajous(Canvas& canvas, const AnalyzedAudioFrame& audio,
                                  const Variation& variation, float elapsedSeconds, float hue) {
  const int frequencyX = 2 + variation.variant;
  const int frequencyY = variation.symmetry;
  int previousX = canvas.width() / 2;
  int previousY = canvas.height() / 2;
  for (int index = 0; index <= 180; ++index) {
    const float phase = static_cast<float>(index) / 180.0F * 2.0F * kPi;
    const float drift = elapsedSeconds * variation.speed * 0.35F * variation.direction;
    const float amplitudeX = canvas.width() * 0.42F * variation.scale;
    const float amplitudeY = canvas.height() * (0.33F + audio.level * 0.1F) * variation.scale;
    const int x = canvas.width() / 2 + scaled(std::sin(phase * frequencyX + drift) * amplitudeX);
    const int y =
        canvas.height() / 2 + scaled(std::sin(phase * frequencyY + audio.bass * kPi) * amplitudeY);
    const bool hasPrevious = index > 0;
    if (hasPrevious) {
      canvas.line(previousX, previousY, x, y,
                  sceneColor(variation, hue,
                             static_cast<float>(index) / 180.0F * variation.hueSpread,
                             variation.lightness + 15.0F),
                  1 + scaled(audio.beatIntensity * 2.0F));
    }
    previousX = x;
    previousY = y;
  }
}

void SceneRenderer::drawFluid(Canvas& canvas, const AnalyzedAudioFrame& audio,
                              const Variation& variation, float elapsedSeconds, float hue) {
  const int spacing = variation.variant == 2 ? 16 : 22;
  for (int y = -spacing; y < canvas.height() + spacing; y += spacing) {
    for (int x = -spacing; x < canvas.width() + spacing; x += spacing) {
      const float wave = std::sin(x * 0.035F + elapsedSeconds * variation.speed) +
                         std::cos(y * 0.04F - elapsedSeconds * 0.7F);
      const float warp = wave * (8.0F + audio.bass * 16.0F);
      const int drawX = x + scaled(std::sin(y * 0.03F + elapsedSeconds) * warp);
      const int drawY = y + scaled(std::cos(x * 0.03F - elapsedSeconds) * warp);
      const float normalized = clampUnit((wave + 2.0F) * 0.25F);
      const Color color =
          sceneColor(variation, hue, normalized * variation.hueSpread, 35.0F + normalized * 34.0F);
      canvas.circle(drawX, drawY, scaled(5.0F + normalized * 9.0F), color, true);
    }
  }
}

void SceneRenderer::drawSmoke(Canvas& canvas, const AnalyzedAudioFrame& audio,
                              const Variation& variation, float elapsedSeconds, float hue) {
  const int count = std::clamp(scaled(18.0F * variation.density), 10, 36);
  const bool usesHorizontalSmoke = variation.variant == 1;
  const bool usesOrbitingSmoke = variation.variant == 2;
  const bool usesIncenseSmoke = variation.variant == 3;
  for (int index = 0; index < count; ++index) {
    const float seedX = variation.random(static_cast<std::uint32_t>(index));
    const float seedY = variation.random(static_cast<std::uint32_t>(index + 100));
    const float rise = std::fmod(seedY - elapsedSeconds * 0.04F * variation.speed + 4.0F, 1.0F);
    float x = seedX * canvas.width();
    float y = rise * canvas.height();
    if (usesHorizontalSmoke) {
      x = std::fmod(seedX * canvas.width() + elapsedSeconds * 18.0F,
                    static_cast<float>(canvas.width()));
    } else if (usesOrbitingSmoke) {
      const float angle = seedX * 2.0F * kPi + elapsedSeconds * 0.2F;
      x = canvas.width() / 2.0F + std::cos(angle) * rise * canvas.height() * 0.42F;
      y = canvas.height() / 2.0F + std::sin(angle) * rise * canvas.height() * 0.42F;
    } else if (usesIncenseSmoke) {
      x = canvas.width() / 2.0F + std::sin(rise * 12.0F + elapsedSeconds) * 24.0F;
    }
    const int radius = scaled((10.0F + rise * 22.0F + audio.level * 10.0F) * variation.scale);
    const Color color = sceneColor(variation, hue, seedX * 35.0F, 25.0F + rise * 30.0F, 80);
    canvas.circle(scaled(x), scaled(y), radius, color, true);
  }
}

void SceneRenderer::drawLava(Canvas& canvas, const AnalyzedAudioFrame& audio,
                             const Variation& variation, float elapsedSeconds, float hue) {
  const int count = std::clamp(scaled(9.0F * variation.density), 6, 18);
  const bool usesHorizontalLava = variation.variant == 1;
  const bool usesOrbitingLava = variation.variant == 2;
  const bool usesMirroredLava = variation.variant == 3;
  for (int index = 0; index < count; ++index) {
    const float randomX = variation.random(static_cast<std::uint32_t>(index));
    const float randomY = variation.random(static_cast<std::uint32_t>(index + 200));
    const float phase = elapsedSeconds * variation.speed * (0.3F + randomY * 0.3F) + index;
    float x = randomX * canvas.width();
    float y = canvas.height() / 2.0F + std::sin(phase) * canvas.height() * 0.38F;
    if (usesHorizontalLava) {
      x = canvas.width() / 2.0F + std::sin(phase) * canvas.width() * 0.42F;
      y = randomY * canvas.height();
    } else if (usesOrbitingLava) {
      x = canvas.width() / 2.0F + std::cos(phase) * canvas.height() * 0.32F;
      y = canvas.height() / 2.0F + std::sin(phase) * canvas.height() * 0.32F;
    } else if (usesMirroredLava) {
      x = index % 2 == 0 ? canvas.width() * 0.32F : canvas.width() * 0.68F;
    }
    const int radius = scaled((12.0F + randomY * 18.0F + audio.bass * 12.0F) * variation.scale);
    canvas.circle(
        scaled(x), scaled(y), radius,
        sceneColor(variation, hue, randomX * variation.hueSpread, 45.0F + audio.level * 25.0F),
        true);
    canvas.circle(scaled(x), scaled(y), std::max(2, radius - 5),
                  sceneColor(variation, hue, 25.0F + randomX * variation.hueSpread,
                             58.0F + audio.level * 20.0F),
                  false);
  }
}

void SceneRenderer::drawAurora(Canvas& canvas, const AnalyzedAudioFrame& audio,
                               const Variation& variation, float elapsedSeconds, float hue) {
  const int ribbons = 3 + variation.variant;
  const bool usesHorizonAurora = variation.variant == 1;
  const bool usesNebulaAurora = variation.variant == 2;
  for (int ribbon = 0; ribbon < ribbons; ++ribbon) {
    int previousX = 0;
    int previousY = canvas.height() / 2;
    for (int x = 0; x < canvas.width(); x += 3) {
      const float unit = static_cast<float>(x) / canvas.width();
      const float wave = std::sin(unit * (5.0F + variation.symmetry) +
                                  elapsedSeconds * variation.speed + ribbon * 1.7F);
      const float noise =
          std::sin(unit * 19.0F - elapsedSeconds * 0.4F + ribbon) * variation.wobble;
      int y = scaled(canvas.height() * (0.18F + ribbon * 0.1F) +
                     (wave + noise) * (18.0F + audio.mid * 25.0F));
      if (usesHorizonAurora) {
        y += canvas.height() / 3;
      } else if (usesNebulaAurora) {
        y = canvas.height() / 2 + scaled((wave + noise) * canvas.height() * 0.25F);
      }
      const bool hasPrevious = x > 0;
      if (hasPrevious) {
        canvas.line(previousX, previousY, x, y,
                    sceneColor(variation, hue,
                               static_cast<float>(ribbon) / ribbons * variation.hueSpread,
                               variation.lightness + audio.level * 18.0F),
                    variation.variant == 3 ? 5 : 3);
      }
      previousX = x;
      previousY = y;
    }
  }
}

void SceneRenderer::drawSemanticSynth(Canvas& canvas, const AnalyzedAudioFrame& audio,
                                      const Variation& variation, float elapsedSeconds, float hue) {
  const int cells = std::clamp(variation.symmetry * 2, 4, 16);
  const float cellWidth = static_cast<float>(canvas.width()) / cells;
  const float cellHeight = static_cast<float>(canvas.height()) / cells;
  for (int y = 0; y < cells; ++y) {
    for (int x = 0; x < cells; ++x) {
      const std::uint32_t index = static_cast<std::uint32_t>(y * cells + x);
      const float random = variation.random(index);
      const float oscillator =
          0.5F + 0.5F * std::sin(elapsedSeconds * variation.speed * (1.0F + random * 3.0F) +
                                 index * 0.31F + audio.tempo.barPhase * kPi);
      const float modulation =
          clampUnit(oscillator * 0.55F + audio.bass * 0.3F + audio.treble * random * 0.25F);
      const Color color =
          sceneColor(variation, hue, random * variation.hueSpread, 18.0F + modulation * 62.0F);
      const int centerX = scaled((x + 0.5F) * cellWidth);
      const int centerY = scaled((y + 0.5F) * cellHeight);
      const int radius = std::max(1, scaled(std::min(cellWidth, cellHeight) * 0.48F * modulation));
      const bool useCircle = (variation.variant + x + y) % 2 == 0;
      if (useCircle) {
        canvas.circle(centerX, centerY, radius, color, variation.shape < 0.7F);
      } else {
        canvas.rectangle(centerX - radius, centerY - radius, radius * 2, radius * 2, color,
                         variation.shape < 0.7F);
      }
    }
  }
  canvas.text(4, 4, "SYNTH", sceneColor(variation, hue, 0.0F, 85.0F));
}

} // namespace stackchan
