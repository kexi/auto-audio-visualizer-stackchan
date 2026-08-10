#include "visualizer/scene_renderer.hpp"

#include "visualizer/generated_catalog.hpp"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <optional>

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

float lerp(float from, float to, float progress) { return from + (to - from) * progress; }

float lerpHue(float from, float to, float progress) {
  float distance = std::fmod(to - from + 540.0F, 360.0F) - 180.0F;
  const bool wrappedTooFar = distance < -180.0F;
  if (wrappedTooFar) {
    distance += 360.0F;
  }
  return wrapHue(from + distance * progress);
}

std::size_t flatObjectEnd(const std::string& json, std::size_t objectStart) {
  const std::size_t end = json.find('}', objectStart);
  return end == std::string::npos ? json.size() : end;
}

Color sceneColor(const Variation& variation, float hue, float offset, float lightness,
                 std::uint8_t alpha = 255) {
  return hsl(hue + offset, variation.saturation, lightness, alpha);
}

int scaled(float value) { return static_cast<int>(std::round(value)); }

std::uint32_t fnv1a(const std::string& value) {
  std::uint32_t hash = 2166136261U;
  for (const unsigned char byte : value) {
    hash ^= byte;
    hash *= 16777619U;
  }
  return hash;
}

float hashUnit(std::uint32_t value) {
  value ^= value >> 16U;
  value *= 0x7FEB352DU;
  value ^= value >> 15U;
  value *= 0x846CA68BU;
  value ^= value >> 16U;
  return static_cast<float>(value >> 8U) / 16777216.0F;
}

class OpacityCanvas final : public Canvas {
public:
  OpacityCanvas(Canvas& target, float opacity)
      : target_(target), opacity_(std::clamp(opacity, 0.0F, 1.0F)) {}

  [[nodiscard]] int width() const override { return target_.width(); }
  [[nodiscard]] int height() const override { return target_.height(); }
  void clear(Color color) override { static_cast<void>(color); }

  void line(int x1, int y1, int x2, int y2, Color color, int thickness) override {
    const bool drawsCommand = shouldDraw();
    if (drawsCommand) {
      target_.line(x1, y1, x2, y2, faded(color), thickness);
    }
  }

  void rectangle(int x, int y, int width, int height, Color color, bool filled) override {
    const bool drawsCommand = shouldDraw();
    if (drawsCommand) {
      target_.rectangle(x, y, width, height, faded(color), filled);
    }
  }

  void circle(int x, int y, int radius, Color color, bool filled) override {
    const bool drawsCommand = shouldDraw();
    if (drawsCommand) {
      target_.circle(x, y, radius, faded(color), filled);
    }
  }

  void text(int x, int y, const std::string& value, Color color) override {
    const bool drawsCommand = shouldDraw();
    if (drawsCommand) {
      target_.text(x, y, value, faded(color));
    }
  }

  bool image(const ImageAsset& asset, int x, int y, int width, int height) override {
    const bool drawsCommand = shouldDraw();
    return drawsCommand && target_.image(asset, x, y, width, height);
  }

private:
  [[nodiscard]] bool shouldDraw() {
    const std::uint32_t command = commandIndex_++;
    const bool isInvisible = opacity_ <= 0.0F;
    if (isInvisible) {
      return false;
    }
    const bool isOpaque = opacity_ >= 1.0F;
    return isOpaque || hashUnit(command ^ 0xD1B54A35U) < opacity_;
  }

  [[nodiscard]] Color faded(Color color) const {
    color.alpha = static_cast<std::uint8_t>(static_cast<float>(color.alpha) * opacity_);
    return color;
  }

  Canvas& target_;
  float opacity_ = 1.0F;
  std::uint32_t commandIndex_ = 0;
};

std::optional<std::string> stringAfterKey(const std::string& json, const std::string& key,
                                          std::size_t begin, std::size_t limit) {
  const std::size_t keyPosition = json.find('"' + key + '"', begin);
  const bool hasKey = keyPosition != std::string::npos && keyPosition < limit;
  if (!hasKey) {
    return std::nullopt;
  }
  const std::size_t colon = json.find(':', keyPosition + key.size() + 2U);
  const std::size_t quote =
      colon == std::string::npos ? std::string::npos : json.find('"', colon + 1U);
  const std::size_t endQuote =
      quote == std::string::npos ? std::string::npos : json.find('"', quote + 1U);
  const bool hasValue =
      quote != std::string::npos && endQuote != std::string::npos && endQuote < limit;
  return hasValue ? std::optional<std::string>{json.substr(quote + 1U, endQuote - quote - 1U)}
                  : std::nullopt;
}

std::optional<float> numberAfterKey(const std::string& json, const std::string& key,
                                    std::size_t begin, std::size_t limit) {
  const std::size_t keyPosition = json.find('"' + key + '"', begin);
  const bool hasKey = keyPosition != std::string::npos && keyPosition < limit;
  if (!hasKey) {
    return std::nullopt;
  }
  const std::size_t colon = json.find(':', keyPosition + key.size() + 2U);
  const bool hasColon = colon != std::string::npos && colon < limit;
  if (!hasColon) {
    return std::nullopt;
  }
  const char* start = json.c_str() + colon + 1U;
  char* end = nullptr;
  const float value = std::strtof(start, &end);
  const bool consumedNumber = end != start && static_cast<std::size_t>(end - json.c_str()) <= limit;
  const bool hasFiniteValue = consumedNumber && std::isfinite(value);
  return hasFiniteValue ? std::optional<float>{value} : std::nullopt;
}

float semanticRouteSource(const std::string& source, const AnalyzedAudioFrame& audio,
                          float elapsedSeconds) {
  const bool usesBass = source == "audio:bass";
  if (usesBass) {
    return audio.bass;
  }
  const bool usesMid = source == "audio:mid";
  if (usesMid) {
    return audio.mid;
  }
  const bool usesTreble = source == "audio:treble";
  if (usesTreble) {
    return audio.treble;
  }
  const bool usesLevel = source == "audio:level";
  if (usesLevel) {
    return audio.level;
  }
  const bool usesBeat = source == "audio:beat";
  if (usesBeat) {
    return audio.beat ? 1.0F : 0.0F;
  }
  const bool usesBeatIntensity = source == "audio:beatIntensity";
  if (usesBeatIntensity) {
    return audio.beatIntensity;
  }
  const bool usesGridPulse = source == "audio:gridPulse";
  if (usesGridPulse) {
    return audio.tempo.gridPulse;
  }
  const bool usesBarPulse = source == "audio:barPulse";
  if (usesBarPulse) {
    return audio.tempo.barPulse;
  }
  const bool usesBeatPhase = source == "audio:beatPhase";
  if (usesBeatPhase) {
    return audio.tempo.beatPhase;
  }
  const bool usesBarPhase = source == "audio:barPhase";
  if (usesBarPhase) {
    return audio.tempo.barPhase;
  }
  const bool usesTime = source == "time";
  return usesTime ? elapsedSeconds : 0.0F;
}

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
  default:
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
                         float baseHue, const std::string& patchJson, const ImageStore* images,
                         Background background, const std::string& previousPatchJson,
                         PatchTransitionProgress transition) {
  const std::uint8_t backgroundAlpha = background == Background::Transparent ? 0U : 255U;
  canvas.clear({0, 0, 0, backgroundAlpha});
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
  case SceneId::SemanticSynth: {
    const float clampedProgress = std::clamp(transition.topology, 0.0F, 1.0F);
    const bool hasPreviousPatch = !previousPatchJson.empty() && previousPatchJson != patchJson;
    const bool crossfadesPatch = hasPreviousPatch && transition.usesDecks && clampedProgress < 1.0F;
    if (crossfadesPatch) {
      const bool startsNewDeckPair =
          topologyOutgoingRenderer_ == nullptr || topologyIncomingRenderer_ == nullptr ||
          topologyOutgoingPatch_ != previousPatchJson || topologyIncomingPatch_ != patchJson;
      if (startsNewDeckPair) {
        topologyOutgoingRenderer_ = std::make_shared<SceneRenderer>(*this);
        topologyOutgoingRenderer_->topologyOutgoingRenderer_.reset();
        topologyOutgoingRenderer_->topologyIncomingRenderer_.reset();
        topologyIncomingRenderer_ = std::make_shared<SceneRenderer>();
        topologyOutgoingPatch_ = previousPatchJson;
        topologyIncomingPatch_ = patchJson;
      }
      OpacityCanvas outgoing(canvas, 1.0F - clampedProgress);
      topologyOutgoingRenderer_->drawSemanticSynth(outgoing, audio, variation, elapsedSeconds,
                                                   deltaSeconds, hue, previousPatchJson, images);
      OpacityCanvas incoming(canvas, clampedProgress);
      topologyIncomingRenderer_->drawSemanticSynth(incoming, audio, variation, elapsedSeconds,
                                                   deltaSeconds, hue, patchJson, images);
    } else {
      topologyOutgoingRenderer_.reset();
      topologyIncomingRenderer_.reset();
      topologyOutgoingPatch_.clear();
      topologyIncomingPatch_.clear();
      const bool interpolatesAttributes =
          hasPreviousPatch && !transition.usesDecks &&
          (transition.palette < 1.0F || transition.parameter < 1.0F ||
           transition.modulation < 1.0F);
      if (interpolatesAttributes) {
        SceneRenderer previousRenderer;
        const bool retargetsRenderedPatch = hasRenderedSemanticState_ &&
                                            compiledPatchJson_ == previousPatchJson &&
                                            patchJson != compiledPatchJson_;
        if (retargetsRenderedPatch) {
          previousRenderer = *this;
          previousRenderer.semanticParameterSignal_ = renderedSemanticParameterSignal_;
          previousRenderer.semanticDiscreteParameterHash_ = renderedSemanticDiscreteParameterHash_;
          previousRenderer.semanticPaletteMode_ = renderedSemanticPaletteMode_;
          previousRenderer.semanticPaletteHue_ = renderedSemanticPaletteHue_;
          previousRenderer.semanticPaletteSaturation_ = renderedSemanticPaletteSaturation_;
          previousRenderer.semanticPaletteLightness_ = renderedSemanticPaletteLightness_;
          previousRenderer.semanticCompositionSymmetry_ = renderedSemanticCompositionSymmetry_;
          previousRenderer.semanticCompositionScale_ = renderedSemanticCompositionScale_;
          previousRenderer.semanticCompositionSpeed_ = renderedSemanticCompositionSpeed_;
          previousRenderer.hasFrozenSemanticRouteOffsets_ = true;
          previousRenderer.frozenSemanticRouteOffsets_ = renderedSemanticRouteOffsets_;
        } else {
          previousRenderer.compileSemanticPatch(previousPatchJson);
        }
        drawSemanticSynth(canvas, audio, variation, elapsedSeconds, deltaSeconds, hue, patchJson,
                          images, &previousRenderer, transition);
      } else {
        drawSemanticSynth(canvas, audio, variation, elapsedSeconds, deltaSeconds, hue, patchJson,
                          images);
      }
    }
    break;
  }
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
  const bool usesEdgeJets = variation.variant == 1;
  const bool usesMandala = variation.variant == 2;
  const bool usesRibbon = variation.variant == 3;
  const int spacing = usesMandala ? 16 : 22;
  for (int y = -spacing; y < canvas.height() + spacing; y += spacing) {
    for (int x = -spacing; x < canvas.width() + spacing; x += spacing) {
      const float wave = std::sin(x * 0.035F + elapsedSeconds * variation.speed) +
                         std::cos(y * 0.04F - elapsedSeconds * 0.7F);
      const float warp = wave * (8.0F + audio.bass * 16.0F);
      int drawX = x + scaled(std::sin(y * 0.03F + elapsedSeconds) * warp);
      int drawY = y + scaled(std::cos(x * 0.03F - elapsedSeconds) * warp);
      if (usesEdgeJets) {
        const bool comesFromLeft = ((x / spacing) & 1) == 0;
        const int edge = comesFromLeft ? 0 : canvas.width();
        drawX = edge + (comesFromLeft ? 1 : -1) * scaled((y + spacing) * 0.45F + warp);
      } else if (usesMandala) {
        const float centeredX =
            static_cast<float>(drawX) - static_cast<float>(canvas.width()) * 0.5F;
        const float centeredY =
            static_cast<float>(drawY) - static_cast<float>(canvas.height()) * 0.5F;
        const float radius = std::sqrt(centeredX * centeredX + centeredY * centeredY);
        const float angle = std::atan2(centeredY, centeredX);
        const float folded = std::fmod(std::abs(angle), kPi / 3.0F);
        drawX = canvas.width() / 2 + scaled(std::cos(folded) * radius);
        drawY = canvas.height() / 2 + scaled(std::sin(folded) * radius);
      } else if (usesRibbon) {
        const float band = static_cast<float>(y + spacing) / spacing;
        drawY = canvas.height() / 2 +
                scaled(std::sin(x * 0.035F + elapsedSeconds + band) * (18.0F + band * 3.0F));
      }
      const float normalized = clampUnit((wave + 2.0F) * 0.25F);
      const Color color =
          sceneColor(variation, hue, normalized * variation.hueSpread, 35.0F + normalized * 34.0F);
      const int radius = scaled(5.0F + normalized * 9.0F);
      if (usesRibbon) {
        canvas.rectangle(drawX - radius, drawY - radius / 2, radius * 2, radius, color, true);
      } else {
        canvas.circle(drawX, drawY, radius, color, true);
      }
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
  const float unitStep = 3.0F / canvas.width();
  const float wavePhaseStep = unitStep * (5.0F + variation.symmetry);
  const float waveCosStep = std::cos(wavePhaseStep);
  const float waveSinStep = std::sin(wavePhaseStep);
  const float noisePhaseStep = unitStep * 19.0F;
  const float noiseCosStep = std::cos(noisePhaseStep);
  const float noiseSinStep = std::sin(noisePhaseStep);
  for (int ribbon = 0; ribbon < ribbons; ++ribbon) {
    int previousX = 0;
    int previousY = canvas.height() / 2;
    const float waveStart = elapsedSeconds * variation.speed + ribbon * 1.7F;
    float waveSin = std::sin(waveStart);
    float waveCos = std::cos(waveStart);
    const float noiseStart = -elapsedSeconds * 0.4F + ribbon;
    float noiseSin = std::sin(noiseStart);
    float noiseCos = std::cos(noiseStart);
    for (int x = 0; x < canvas.width(); x += 3) {
      const float wave = waveSin;
      const float noise = noiseSin * variation.wobble;
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
      const float nextWaveSin = waveSin * waveCosStep + waveCos * waveSinStep;
      waveCos = waveCos * waveCosStep - waveSin * waveSinStep;
      waveSin = nextWaveSin;
      const float nextNoiseSin = noiseSin * noiseCosStep + noiseCos * noiseSinStep;
      noiseCos = noiseCos * noiseCosStep - noiseSin * noiseSinStep;
      noiseSin = nextNoiseSin;
    }
  }
}

void SceneRenderer::compileSemanticPatch(const std::string& patchJson) {
  const bool isCurrent = patchJson == compiledPatchJson_;
  if (isCurrent) {
    return;
  }
  compiledPatchJson_ = patchJson;
  sourceHashes_.clear();
  fieldHashes_.clear();
  modifierHashes_.clear();
  materialHashes_.clear();
  semanticGraphHash_ = 2166136261U;
  semanticDiscreteParameterHash_ = 2166136261U;
  semanticParameterSignal_ = 0.0F;
  semanticPaletteMode_ = 0;
  semanticPaletteHue_ = 0.0F;
  semanticPaletteSaturation_ = 75.0F;
  semanticPaletteLightness_ = 50.0F;
  semanticCompositionSymmetry_ = 4.0F;
  semanticCompositionScale_ = 1.0F;
  semanticCompositionSpeed_ = 1.0F;
  semanticImageHashes_.clear();
  semanticRoutes_.clear();
  usesImageSource_ = false;

  std::size_t position = 0;
  constexpr const char* kGeneratorKey = "\"generatorId\"";
  while (position < patchJson.size()) {
    const std::size_t key = patchJson.find(kGeneratorKey, position);
    const bool hasKey = key != std::string::npos;
    if (!hasKey) {
      break;
    }
    const std::size_t colon =
        patchJson.find(':', key + std::char_traits<char>::length(kGeneratorKey));
    const std::size_t quote =
        colon == std::string::npos ? std::string::npos : patchJson.find('"', colon + 1);
    const std::size_t endQuote =
        quote == std::string::npos ? std::string::npos : patchJson.find('"', quote + 1);
    const bool hasValue = quote != std::string::npos && endQuote != std::string::npos;
    if (!hasValue) {
      break;
    }
    const std::string generatorId = patchJson.substr(quote + 1, endQuote - quote - 1);
    for (std::size_t index = 0; index < kGeneratorDefinitionCount; ++index) {
      const auto& definition = kGeneratorDefinitions[index];
      const bool matches = generatorId == definition.id;
      if (!matches) {
        continue;
      }
      const std::uint32_t hash = fnv1a(generatorId);
      semanticGraphHash_ ^= hash;
      semanticGraphHash_ *= 16777619U;
      const bool isImageSource = generatorId == "stamp";
      usesImageSource_ = usesImageSource_ || isImageSource;
      const std::string category = definition.category;
      const bool isSource = category == "source";
      const bool isField = category == "field";
      const bool isModifier = category == "modifier";
      if (isSource) {
        sourceHashes_.push_back(hash);
      } else if (isField) {
        fieldHashes_.push_back(hash);
      } else if (isModifier) {
        modifierHashes_.push_back(hash);
      } else {
        materialHashes_.push_back(hash);
      }
      break;
    }
    position = endQuote + 1;
  }

  position = 0;
  constexpr const char* kParametersKey = "\"parameters\"";
  std::uint32_t parameterIndex = 1U;
  while (position < patchJson.size()) {
    const std::size_t key = patchJson.find(kParametersKey, position);
    const bool hasParameters = key != std::string::npos;
    if (!hasParameters) {
      break;
    }
    const std::size_t objectStart = patchJson.find('{', key);
    const bool hasObject = objectStart != std::string::npos;
    if (!hasObject) {
      break;
    }
    const std::size_t objectEnd = flatObjectEnd(patchJson, objectStart);
    std::size_t valuePosition = objectStart + 1U;
    while (valuePosition < objectEnd) {
      const std::size_t colon = patchJson.find(':', valuePosition);
      const bool hasValue = colon != std::string::npos && colon < objectEnd;
      if (!hasValue) {
        break;
      }
      const char* start = patchJson.c_str() + colon + 1U;
      char* end = nullptr;
      const float value = std::strtof(start, &end);
      const bool isNumeric =
          end != start && static_cast<std::size_t>(end - patchJson.c_str()) <= objectEnd;
      if (isNumeric) {
        const float weight = 0.25F + hashUnit(parameterIndex * 0x9E3779B9U) * 0.75F;
        semanticParameterSignal_ += value * weight;
      } else {
        const std::size_t tokenEnd = patchJson.find_first_of(",}", colon + 1U);
        const bool hasToken = tokenEnd != std::string::npos && tokenEnd <= objectEnd;
        if (hasToken) {
          semanticDiscreteParameterHash_ ^=
              fnv1a(patchJson.substr(colon + 1U, tokenEnd - colon - 1U));
          semanticDiscreteParameterHash_ *= 16777619U;
        }
      }
      ++parameterIndex;
      const std::size_t comma = patchJson.find(',', colon + 1U);
      const bool hasMore = comma != std::string::npos && comma < objectEnd;
      valuePosition = hasMore ? comma + 1U : objectEnd;
    }
    position = objectEnd + 1U;
  }

  const std::size_t paletteStart = patchJson.find("\"palette\"");
  const bool hasPalette = paletteStart != std::string::npos;
  if (hasPalette) {
    const std::size_t paletteEnd = flatObjectEnd(patchJson, paletteStart);
    const std::string mode =
        stringAfterKey(patchJson, "mode", paletteStart, paletteEnd).value_or("mono");
    const bool usesAnalogous = mode == "analogous";
    const bool usesComplementary = mode == "complementary";
    const bool usesTriadic = mode == "triadic";
    const bool usesRainbow = mode == "rainbow";
    semanticPaletteMode_ = usesAnalogous       ? 1
                           : usesComplementary ? 2
                           : usesTriadic       ? 3
                           : usesRainbow       ? 4
                                               : 0;
    semanticPaletteHue_ =
        numberAfterKey(patchJson, "hueOffset", paletteStart, paletteEnd).value_or(0.0F);
    semanticPaletteSaturation_ =
        numberAfterKey(patchJson, "saturation", paletteStart, paletteEnd).value_or(75.0F);
    semanticPaletteLightness_ =
        numberAfterKey(patchJson, "lightness", paletteStart, paletteEnd).value_or(50.0F);
  }

  const std::size_t compositionStart = patchJson.find("\"composition\"");
  const bool hasComposition = compositionStart != std::string::npos;
  if (hasComposition) {
    const std::size_t compositionEnd = flatObjectEnd(patchJson, compositionStart);
    semanticCompositionSymmetry_ =
        numberAfterKey(patchJson, "symmetry", compositionStart, compositionEnd).value_or(4.0F);
    semanticCompositionScale_ =
        numberAfterKey(patchJson, "scale", compositionStart, compositionEnd).value_or(1.0F);
    semanticCompositionSpeed_ =
        numberAfterKey(patchJson, "speed", compositionStart, compositionEnd).value_or(1.0F);
  }

  constexpr const char* kHashKey = "\"hash\"";
  position = 0;
  while (position < patchJson.size()) {
    const std::size_t hashKey = patchJson.find(kHashKey, position);
    const bool hasHashKey = hashKey != std::string::npos;
    if (!hasHashKey) {
      break;
    }
    const std::size_t hashColon = patchJson.find(':', hashKey + 6U);
    const std::size_t hashQuote =
        hashColon == std::string::npos ? std::string::npos : patchJson.find('"', hashColon + 1U);
    const std::size_t hashEnd =
        hashQuote == std::string::npos ? std::string::npos : patchJson.find('"', hashQuote + 1U);
    const bool hasImageHash = hashQuote != std::string::npos && hashEnd != std::string::npos;
    if (!hasImageHash) {
      break;
    }
    semanticImageHashes_.push_back(patchJson.substr(hashQuote + 1U, hashEnd - hashQuote - 1U));
    position = hashEnd + 1U;
  }

  position = 0;
  constexpr const char* kSourceKey = "\"source\"";
  while (position < patchJson.size()) {
    const std::size_t sourceKey = patchJson.find(kSourceKey, position);
    const bool hasSourceKey = sourceKey != std::string::npos;
    if (!hasSourceKey) {
      break;
    }
    const std::size_t routeEnd = patchJson.find('}', sourceKey);
    const bool hasRouteEnd = routeEnd != std::string::npos;
    if (!hasRouteEnd) {
      break;
    }
    const auto source = stringAfterKey(patchJson, "source", sourceKey, routeEnd);
    const auto target = stringAfterKey(patchJson, "target", sourceKey, routeEnd);
    const auto amount = numberAfterKey(patchJson, "amount", sourceKey, routeEnd);
    const auto polarity = stringAfterKey(patchJson, "polarity", sourceKey, routeEnd);
    const auto smoothing = numberAfterKey(patchJson, "smoothing", sourceKey, routeEnd);
    const bool hasRoute = source.has_value() && target.has_value() && amount.has_value() &&
                          polarity.has_value() && smoothing.has_value();
    if (hasRoute) {
      semanticRoutes_.push_back(
          {*source, *target, *amount, *smoothing, 0.0F, *polarity == "bipolar"});
    }
    position = routeEnd + 1U;
  }
}

void SceneRenderer::drawSemanticSynth(Canvas& canvas, const AnalyzedAudioFrame& audio,
                                      const Variation& variation, float elapsedSeconds,
                                      float deltaSeconds, float hue, const std::string& patchJson,
                                      const ImageStore* images, const SceneRenderer* previousPatch,
                                      PatchTransitionProgress transition) {
  compileSemanticPatch(patchJson);
  for (SemanticRouteState& route : semanticRoutes_) {
    const float raw = semanticRouteSource(route.source, audio, elapsedSeconds);
    const bool bypassesSmoothing = route.smoothing <= 0.0F;
    const float blend =
        bypassesSmoothing
            ? 1.0F
            : 1.0F - std::exp(-std::max(0.0F, deltaSeconds) / std::max(0.0001F, route.smoothing));
    route.smoothed += (raw - route.smoothed) * blend;
  }
  const bool hasPreviousPatch = previousPatch != nullptr;
  std::array<float, 4> routeOffsets{};
  const auto addRoute = [&](const SemanticRouteState& route, float value, float amount) {
    const float polarized = route.bipolar ? value * 2.0F - 1.0F : value;
    const std::size_t bucket = fnv1a(route.target) % routeOffsets.size();
    routeOffsets[bucket] += polarized * amount;
  };
  if (!hasPreviousPatch) {
    for (const SemanticRouteState& route : semanticRoutes_) {
      addRoute(route, route.smoothed, route.amount);
    }
  } else if (previousPatch->hasFrozenSemanticRouteOffsets_) {
    for (const SemanticRouteState& route : semanticRoutes_) {
      addRoute(route, route.smoothed, route.amount);
    }
    for (std::size_t index = 0; index < routeOffsets.size(); ++index) {
      routeOffsets[index] = lerp(previousPatch->frozenSemanticRouteOffsets_[index],
                                 routeOffsets[index], transition.modulation);
    }
  } else {
    for (const SemanticRouteState& outgoing : previousPatch->semanticRoutes_) {
      const auto incoming =
          std::find_if(semanticRoutes_.begin(), semanticRoutes_.end(),
                       [&outgoing](const SemanticRouteState& route) {
                         return route.source == outgoing.source && route.target == outgoing.target;
                       });
      const bool hasIncomingRoute = incoming != semanticRoutes_.end();
      if (hasIncomingRoute) {
        const bool usesOutgoingDiscreteFields = transition.modulation < 0.5F;
        const SemanticRouteState& discreteRoute = usesOutgoingDiscreteFields ? outgoing : *incoming;
        const float raw = semanticRouteSource(discreteRoute.source, audio, elapsedSeconds);
        const float value = usesOutgoingDiscreteFields ? raw : incoming->smoothed;
        const float amount = lerp(outgoing.amount, incoming->amount, transition.modulation);
        addRoute(discreteRoute, value, amount);
      } else {
        const float raw = semanticRouteSource(outgoing.source, audio, elapsedSeconds);
        addRoute(outgoing, raw, outgoing.amount * (1.0F - transition.modulation));
      }
    }
    for (const SemanticRouteState& incoming : semanticRoutes_) {
      const auto outgoing =
          std::find_if(previousPatch->semanticRoutes_.begin(), previousPatch->semanticRoutes_.end(),
                       [&incoming](const SemanticRouteState& route) {
                         return route.source == incoming.source && route.target == incoming.target;
                       });
      const bool isAddedRoute = outgoing == previousPatch->semanticRoutes_.end();
      if (isAddedRoute) {
        addRoute(incoming, incoming.smoothed, incoming.amount * transition.modulation);
      }
    }
  }
  const float parameterSignal = hasPreviousPatch
                                    ? lerp(previousPatch->semanticParameterSignal_,
                                           semanticParameterSignal_, transition.parameter)
                                    : semanticParameterSignal_;
  const float paletteHue = hasPreviousPatch ? lerpHue(previousPatch->semanticPaletteHue_,
                                                      semanticPaletteHue_, transition.palette)
                                            : semanticPaletteHue_;
  const float paletteSaturation = hasPreviousPatch
                                      ? lerp(previousPatch->semanticPaletteSaturation_,
                                             semanticPaletteSaturation_, transition.palette)
                                      : semanticPaletteSaturation_;
  const float paletteLightness = hasPreviousPatch
                                     ? lerp(previousPatch->semanticPaletteLightness_,
                                            semanticPaletteLightness_, transition.palette)
                                     : semanticPaletteLightness_;
  const float compositionSymmetry = hasPreviousPatch
                                        ? lerp(previousPatch->semanticCompositionSymmetry_,
                                               semanticCompositionSymmetry_, transition.parameter)
                                        : semanticCompositionSymmetry_;
  const float compositionScale = hasPreviousPatch
                                     ? lerp(previousPatch->semanticCompositionScale_,
                                            semanticCompositionScale_, transition.parameter)
                                     : semanticCompositionScale_;
  const float compositionSpeed = hasPreviousPatch
                                     ? lerp(previousPatch->semanticCompositionSpeed_,
                                            semanticCompositionSpeed_, transition.parameter)
                                     : semanticCompositionSpeed_;
  const bool usesOutgoingDiscreteParameters = hasPreviousPatch && transition.parameter < 0.5F;
  const std::uint32_t discreteParameterHash = usesOutgoingDiscreteParameters
                                                  ? previousPatch->semanticDiscreteParameterHash_
                                                  : semanticDiscreteParameterHash_;
  const bool usesOutgoingPaletteMode = hasPreviousPatch && transition.palette < 0.5F;
  const int paletteMode =
      usesOutgoingPaletteMode ? previousPatch->semanticPaletteMode_ : semanticPaletteMode_;
  const float parameterPhase = std::fmod(std::abs(parameterSignal), 31.0F) / 31.0F;
  const float graphHueOffset = hashUnit(semanticGraphHash_ ^ discreteParameterHash) * 360.0F;
  hasRenderedSemanticState_ = true;
  renderedSemanticParameterSignal_ = parameterSignal;
  renderedSemanticDiscreteParameterHash_ = discreteParameterHash;
  renderedSemanticPaletteMode_ = paletteMode;
  renderedSemanticPaletteHue_ = paletteHue;
  renderedSemanticPaletteSaturation_ = paletteSaturation;
  renderedSemanticPaletteLightness_ = paletteLightness;
  renderedSemanticCompositionSymmetry_ = compositionSymmetry;
  renderedSemanticCompositionScale_ = compositionScale;
  renderedSemanticCompositionSpeed_ = compositionSpeed;
  renderedSemanticRouteOffsets_ = routeOffsets;
  const auto semanticColor = [&](float offset, float lightness, std::uint8_t alpha = 255U) {
    const float adjustedLightness =
        std::clamp(lightness + (paletteLightness - 50.0F) * 0.35F, 0.0F, 100.0F);
    return hsl(hue + paletteHue + graphHueOffset + offset, paletteSaturation, adjustedLightness,
               alpha);
  };
  std::vector<const ImageAsset*> imageAssets;
  const bool canResolveImages = usesImageSource_ && images != nullptr;
  if (canResolveImages) {
    for (const std::string& hash : semanticImageHashes_) {
      const ImageAsset* asset = images->get(hash);
      const bool hasAsset = asset != nullptr;
      if (hasAsset) {
        imageAssets.push_back(asset);
      }
    }
  }
  const bool drawsImage = !imageAssets.empty();
  if (drawsImage) {
    const int columns = std::max(1, static_cast<int>(std::ceil(std::sqrt(imageAssets.size()))));
    const int rows =
        std::max(1, static_cast<int>((imageAssets.size() + static_cast<std::size_t>(columns) - 1U) /
                                     static_cast<std::size_t>(columns)));
    const int imageWidth = canvas.width() / columns;
    const int imageHeight = canvas.height() / rows;
    for (std::size_t index = 0; index < imageAssets.size(); ++index) {
      const int column = static_cast<int>(index % static_cast<std::size_t>(columns));
      const int row = static_cast<int>(index / static_cast<std::size_t>(columns));
      canvas.image(*imageAssets[index], column * imageWidth, row * imageHeight, imageWidth,
                   imageHeight);
    }
  }
  const std::uint32_t sourceHash =
      sourceHashes_.empty() ? semanticGraphHash_ : sourceHashes_.front();
  const std::uint32_t fieldHash =
      fieldHashes_.empty() ? semanticGraphHash_ ^ 0xA341316CU : fieldHashes_.front();
  const std::uint32_t modifierHash =
      modifierHashes_.empty() ? semanticGraphHash_ ^ 0xC8013EA4U : modifierHashes_.front();
  const std::uint32_t materialHash =
      materialHashes_.empty() ? semanticGraphHash_ ^ 0xAD90777DU : materialHashes_.front();
  const int sourceMode = static_cast<int>(sourceHash % 6U);
  const int fieldMode = static_cast<int>(fieldHash % 4U);
  const int modifierMode = static_cast<int>(modifierHash % 5U);
  const int materialMode = static_cast<int>(materialHash % 5U);
  const int densityOffset = static_cast<int>(std::round(parameterPhase * 4.0F));
  const int cells =
      std::clamp(static_cast<int>(std::round(compositionSymmetry)) * 2 + densityOffset, 5, 18);
  const float cellWidth = static_cast<float>(canvas.width()) / cells;
  const float cellHeight = static_cast<float>(canvas.height()) / cells;
  for (int y = 0; y < cells; ++y) {
    for (int x = 0; x < cells; ++x) {
      const std::uint32_t index = static_cast<std::uint32_t>(y * cells + x);
      const float random = hashUnit(semanticGraphHash_ ^ index * 0x9E3779B9U);
      float unitX = (x + 0.5F) / cells - 0.5F;
      float unitY = (y + 0.5F) / cells - 0.5F;
      const float fieldPhase = elapsedSeconds * (compositionSpeed + routeOffsets[1] * 0.1F) +
                               audio.mid * kPi + routeOffsets[2] + parameterPhase * kPi;
      if (fieldMode == 0) {
        unitX += std::sin(unitY * 12.0F + fieldPhase) * (0.03F + audio.bass * 0.08F);
      } else if (fieldMode == 1) {
        unitY += std::cos(unitX * 14.0F - fieldPhase) * (0.03F + audio.treble * 0.07F);
      } else if (fieldMode == 2) {
        const float angle = std::atan2(unitY, unitX) + fieldPhase * 0.18F;
        const float radius = std::sqrt(unitX * unitX + unitY * unitY);
        unitX = std::cos(angle + radius * 4.0F) * radius;
        unitY = std::sin(angle + radius * 4.0F) * radius;
      } else {
        unitX += (random - 0.5F) * variation.wobble * 0.14F;
        unitY += (hashUnit(fieldHash ^ index) - 0.5F) * variation.wobble * 0.14F;
      }

      const bool mirrorsX = modifierMode == 0 || modifierMode == 3;
      const bool mirrorsY = modifierMode == 1 || modifierMode == 3;
      if (mirrorsX) {
        unitX = std::abs(unitX);
      }
      if (mirrorsY) {
        unitY = std::abs(unitY);
      }
      const float oscillator =
          0.5F + 0.5F * std::sin(elapsedSeconds * compositionSpeed * (1.0F + random * 3.0F) +
                                 (unitX + unitY) * 14.0F + audio.tempo.barPhase * kPi);
      float sourceValue = oscillator;
      if (sourceMode == 0) {
        sourceValue = 1.0F - clampUnit(std::min(std::abs(unitX), std::abs(unitY)) * cells * 2.0F);
      } else if (sourceMode == 1) {
        sourceValue = clampUnit(1.0F - std::sqrt(unitX * unitX + unitY * unitY) * 1.8F);
      } else if (sourceMode == 2) {
        sourceValue = 0.5F + 0.5F * std::sin((unitX * 13.0F + unitY * 9.0F) + fieldPhase);
      } else if (sourceMode == 3) {
        sourceValue = ((x + y) & 1) == 0 ? 0.9F : 0.15F;
      } else if (sourceMode == 4) {
        sourceValue = random;
      }
      const float imageMix = drawsImage ? 0.32F : 1.0F;
      const float modulation =
          clampUnit(sourceValue * (0.55F + routeOffsets[0] * 0.08F) * imageMix + audio.bass * 0.3F +
                    audio.treble * random * 0.25F + routeOffsets[3] * 0.1F);
      const float materialHue = materialMode == 0   ? random * variation.hueSpread
                                : materialMode == 1 ? unitX * 180.0F
                                : materialMode == 2 ? unitY * 220.0F
                                : materialMode == 3 ? oscillator * 300.0F
                                                    : (unitX + unitY) * 180.0F;
      const float paletteMaterialHue =
          paletteMode == 0   ? 0.0F
          : paletteMode == 1 ? std::fmod(materialHue + 30.0F, 60.0F) - 30.0F
          : paletteMode == 2 ? (materialHue >= 0.0F ? 180.0F : 0.0F)
          : paletteMode == 3 ? std::round(materialHue / 120.0F) * 120.0F
                             : materialHue;
      const float materialLightness =
          materialMode == 4 ? 28.0F + (1.0F - modulation) * 52.0F : 18.0F + modulation * 62.0F;
      const Color color =
          semanticColor(paletteMaterialHue + routeOffsets[2] * 45.0F, materialLightness);
      const int centerX = scaled((unitX + 0.5F) * canvas.width());
      const int centerY = scaled((unitY + 0.5F) * canvas.height());
      const int radius = std::max(
          1, scaled(std::min(cellWidth, cellHeight) * 0.48F * modulation * compositionScale));
      const bool useCircle = (modifierMode + sourceMode + x + y) % 2 == 0;
      if (useCircle) {
        canvas.circle(centerX, centerY, radius, color, modifierMode != 4);
      } else {
        canvas.rectangle(centerX - radius, centerY - radius, radius * 2, radius * 2, color,
                         modifierMode != 4);
      }
    }
  }
  const std::string label = sourceHashes_.empty()
                                ? "SYNTH"
                                : "SYNTH " + std::to_string(sourceHashes_.size()) + "/" +
                                      std::to_string(modifierHashes_.size());
  canvas.text(4, 4, label, semanticColor(0.0F, 85.0F));
}

} // namespace stackchan
