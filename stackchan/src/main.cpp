#include <M5StackChan.h>
#include <Preferences.h>

#include <algorithm>
#include <array>
#include <cstdint>
#include <string>
#include <utility>

#include "visualizer/audio.hpp"
#include "visualizer/control.hpp"
#include "visualizer/runtime.hpp"
#include "visualizer/scene_renderer.hpp"

namespace {

constexpr std::uint32_t kSampleRate = 16000;
constexpr std::size_t kSampleCount = 256;
constexpr std::size_t kMaximumControlLine = 1024;

std::array<std::int16_t, kSampleCount> samples{};
stackchan::AudioAnalyzer analyzer;
stackchan::RuntimeController runtime;
stackchan::SceneRenderer sceneRenderer;
M5Canvas frameBuffer(&M5StackChan.Display());
Preferences preferences;
std::uint32_t previousMillis = 0;
std::uint32_t lastMotionBar = 0;
std::string controlLine;

std::uint16_t toRgb565(stackchan::Color color) {
  return static_cast<std::uint16_t>(((color.red & 0xF8U) << 8U) | ((color.green & 0xFCU) << 3U) |
                                    (color.blue >> 3U));
}

class M5CanvasAdapter final : public stackchan::Canvas {
public:
  explicit M5CanvasAdapter(M5Canvas& canvas) : canvas_(canvas) {}

  [[nodiscard]] int width() const override { return canvas_.width(); }
  [[nodiscard]] int height() const override { return canvas_.height(); }

  void clear(stackchan::Color color) override { canvas_.fillScreen(toRgb565(color)); }

  void line(int x1, int y1, int x2, int y2, stackchan::Color color, int thickness) override {
    canvas_.drawLine(x1, y1, x2, y2, toRgb565(color));
    const bool isThick = thickness > 1;
    if (isThick) {
      for (int offset = 1; offset < thickness; ++offset) {
        canvas_.drawLine(x1, y1 + offset, x2, y2 + offset, toRgb565(color));
      }
    }
  }

  void rectangle(int x, int y, int width, int height, stackchan::Color color,
                 bool filled) override {
    const bool hasArea = width > 0 && height > 0;
    if (!hasArea) {
      return;
    }
    if (filled) {
      canvas_.fillRect(x, y, width, height, toRgb565(color));
    } else {
      canvas_.drawRect(x, y, width, height, toRgb565(color));
    }
  }

  void circle(int x, int y, int radius, stackchan::Color color, bool filled) override {
    const bool hasRadius = radius > 0;
    if (!hasRadius) {
      return;
    }
    if (filled) {
      canvas_.fillCircle(x, y, radius, toRgb565(color));
    } else {
      canvas_.drawCircle(x, y, radius, toRgb565(color));
    }
  }

  void text(int x, int y, const std::string& value, stackchan::Color color) override {
    canvas_.setTextColor(toRgb565(color));
    canvas_.setTextSize(1);
    canvas_.setCursor(x, y);
    canvas_.print(value.c_str());
  }

private:
  M5Canvas& canvas_;
};

M5CanvasAdapter canvas(frameBuffer);

stackchan::Settings loadSettings() {
  stackchan::Settings settings{};
  const String storedScene = preferences.getString("scene", stackchan::sceneId(settings.scene));
  settings.scene = stackchan::sceneFromId(storedScene.c_str());
  settings.gain = preferences.getFloat("gain", settings.gain);
  settings.hueMode = preferences.getBool("hueFixed", false) ? stackchan::HueMode::Fixed
                                                            : stackchan::HueMode::Cycle;
  settings.fixedHue = preferences.getFloat("fixedHue", settings.fixedHue);
  settings.background = preferences.getBool("transparent", false)
                            ? stackchan::Background::Transparent
                            : stackchan::Background::Black;
  settings.autoCycle = preferences.getBool("autoCycle", settings.autoCycle);
  settings.cycleSeconds = preferences.getFloat("cycleSec", settings.cycleSeconds);
  settings.cycleMode = preferences.getBool("cycleBars", false) ? stackchan::CycleMode::Bars
                                                               : stackchan::CycleMode::Seconds;
  settings.cycleBars = preferences.getUShort("cycleN", settings.cycleBars);
  settings.autoGacha = preferences.getBool("autoGacha", settings.autoGacha);
  settings.gachaBars = preferences.getUShort("gachaN", settings.gachaBars);
  settings.seed = preferences.getString("seed", settings.seed.c_str()).c_str();
  settings.controlsHidden = preferences.getBool("hideUi", settings.controlsHidden);
  return stackchan::sanitizeSettings(std::move(settings));
}

void saveSettings() {
  const auto& settings = runtime.settings();
  preferences.putString("scene", stackchan::sceneId(settings.scene));
  preferences.putFloat("gain", settings.gain);
  preferences.putBool("hueFixed", settings.hueMode == stackchan::HueMode::Fixed);
  preferences.putFloat("fixedHue", settings.fixedHue);
  preferences.putBool("transparent", settings.background == stackchan::Background::Transparent);
  preferences.putBool("autoCycle", settings.autoCycle);
  preferences.putFloat("cycleSec", settings.cycleSeconds);
  preferences.putBool("cycleBars", settings.cycleMode == stackchan::CycleMode::Bars);
  preferences.putUShort("cycleN", settings.cycleBars);
  preferences.putBool("autoGacha", settings.autoGacha);
  preferences.putUShort("gachaN", settings.gachaBars);
  preferences.putString("seed", settings.seed.c_str());
  preferences.putBool("hideUi", settings.controlsHidden);
}

stackchan::AnalyzedAudioFrame readAudio(std::uint32_t nowMs) {
  const bool didRecord = M5.Mic.record(samples.data(), samples.size(), kSampleRate);
  if (!didRecord) {
    return analyzer.process(nullptr, 0, kSampleRate, runtime.settings().gain, nowMs);
  }
  return analyzer.process(samples.data(), samples.size(), kSampleRate, runtime.settings().gain,
                          nowMs);
}

void updateBody(const stackchan::AnalyzedAudioFrame& audio, const stackchan::Variation& variation) {
  const auto ledColor =
      stackchan::hsl(variation.hueOffset + audio.tempo.barPhase * 360.0F, variation.saturation,
                     4.0F + audio.level * 42.0F + audio.beatIntensity * 28.0F);
  M5StackChan.showRgbColor(ledColor.red, ledColor.green, ledColor.blue);

  const bool isNewBar = audio.tempo.gridBar && audio.tempo.barCount != lastMotionBar;
  if (isNewBar) {
    lastMotionBar = audio.tempo.barCount;
    const float randomX = variation.random(audio.tempo.barCount);
    const float randomY = variation.random(audio.tempo.barCount + 1000U);
    const int yaw = static_cast<int>((randomX * 2.0F - 1.0F) * 550.0F);
    const int pitch = static_cast<int>(180.0F + randomY * 420.0F);
    const int speed = static_cast<int>(250.0F + audio.bass * 450.0F);
    M5StackChan.Motion.move(yaw, pitch, speed);
  }
}

bool handleInput(std::uint32_t entropy, std::uint32_t nowMs) {
  bool settingsChanged = false;
  const bool clicked = M5StackChan.TouchSensor.wasClicked();
  const bool swipedForward = M5StackChan.TouchSensor.wasSwipedForward();
  const bool swipedBackward = M5StackChan.TouchSensor.wasSwipedBackward();
  if (clicked) {
    runtime.reroll(entropy);
    settingsChanged = true;
  } else if (swipedForward) {
    runtime.shiftScene(1);
    settingsChanged = true;
  } else if (swipedBackward) {
    runtime.shiftScene(-1);
    settingsChanged = true;
  }

  const auto touch = M5.Touch.getDetail();
  const bool tappedScreen = touch.wasClicked();
  if (tappedScreen) {
    const bool isLeftZone = touch.x < M5.Display.width() / 3;
    const bool isRightZone = touch.x >= M5.Display.width() * 2 / 3;
    if (isLeftZone) {
      runtime.shiftScene(-1);
      settingsChanged = true;
    } else if (isRightZone) {
      runtime.shiftScene(1);
      settingsChanged = true;
    } else {
      analyzer.tapTempo(nowMs);
    }
  }

  const bool heldScreen = touch.wasHold();
  if (heldScreen) {
    const bool isLeftZone = touch.x < M5.Display.width() / 3;
    const bool isRightZone = touch.x >= M5.Display.width() * 2 / 3;
    if (isLeftZone) {
      analyzer.tempoMultiply(0.5F);
    } else if (isRightZone) {
      analyzer.tempoMultiply(2.0F);
    } else {
      analyzer.tempoAuto();
    }
  }
  return settingsChanged;
}

bool dispatchControl(const stackchan::ControlRequest& request,
                     const stackchan::AnalyzedAudioFrame& audio, std::uint32_t nowMs,
                     std::uint32_t entropy) {
  if (!request.ok) {
    Serial.println(stackchan::encodeControlError(request.id, request.issue).c_str());
    return false;
  }

  bool settingsChanged = false;
  switch (request.method) {
  case stackchan::ControlMethod::GetState: {
    const stackchan::ControlSnapshot snapshot{&runtime.settings(), &audio.tempo,
                                              runtime.variationTransitionActive(),
                                              static_cast<double>(nowMs) / 1000.0};
    Serial.println(stackchan::encodeControlState(request.id, snapshot).c_str());
    return false;
  }
  case stackchan::ControlMethod::ProposeSeed: {
    auto settings = runtime.settings();
    settings.seed = request.text;
    runtime.setSettings(std::move(settings));
    settingsChanged = true;
    break;
  }
  case stackchan::ControlMethod::SetScene: {
    auto settings = runtime.settings();
    settings.scene = stackchan::sceneFromId(request.text);
    runtime.setSettings(std::move(settings));
    settingsChanged = true;
    break;
  }
  case stackchan::ControlMethod::ShiftScene:
    runtime.shiftScene(static_cast<int>(request.number));
    settingsChanged = true;
    break;
  case stackchan::ControlMethod::Reroll:
    runtime.reroll(entropy);
    settingsChanged = true;
    break;
  case stackchan::ControlMethod::TapTempo:
    analyzer.tapTempo(nowMs);
    break;
  case stackchan::ControlMethod::TempoMultiply:
    analyzer.tempoMultiply(request.number);
    break;
  case stackchan::ControlMethod::TempoAuto:
    analyzer.tempoAuto();
    break;
  case stackchan::ControlMethod::Unknown:
    Serial.println(stackchan::encodeControlError(request.id, "unknown method").c_str());
    return false;
  }
  Serial.println(stackchan::encodeControlAck(request.id).c_str());
  return settingsChanged;
}

bool handleSerialControl(const stackchan::AnalyzedAudioFrame& audio, std::uint32_t nowMs,
                         std::uint32_t entropy) {
  bool settingsChanged = false;
  while (Serial.available() > 0) {
    const char character = static_cast<char>(Serial.read());
    const bool endsLine = character == '\n';
    const bool ignoresCarriageReturn = character == '\r';
    if (endsLine) {
      const bool hasRequest = !controlLine.empty();
      if (hasRequest) {
        const auto request = stackchan::parseControlRequest(controlLine);
        settingsChanged = dispatchControl(request, audio, nowMs, entropy) || settingsChanged;
        controlLine.clear();
      }
      continue;
    }
    if (ignoresCarriageReturn) {
      continue;
    }
    const bool hasCapacity = controlLine.size() < kMaximumControlLine;
    if (hasCapacity) {
      controlLine.push_back(character);
    } else {
      controlLine.clear();
      Serial.println(stackchan::encodeControlError(0, "request exceeds 1024 bytes").c_str());
    }
  }
  return settingsChanged;
}

} // namespace

void setup() {
  Serial.begin(115200);
  M5StackChan.begin();
  preferences.begin("visualizer", false);
  runtime.setSettings(loadSettings());
  M5StackChan.Display().setRotation(1);
  frameBuffer.setColorDepth(16);
  frameBuffer.createSprite(320, 240);

  auto microphoneConfig = M5.Mic.config();
  microphoneConfig.sample_rate = kSampleRate;
  M5.Mic.config(microphoneConfig);
  M5.Mic.begin();
  previousMillis = millis();
}

void loop() {
  M5StackChan.update();
  const std::uint32_t currentMillis = millis();
  const float deltaSeconds =
      std::min(static_cast<float>(currentMillis - previousMillis) / 1000.0F, 0.1F);
  previousMillis = currentMillis;

  const bool inputChangedSettings = handleInput(currentMillis ^ esp_random(), currentMillis);
  const auto audio = readAudio(currentMillis);
  const auto runtimeUpdate = runtime.update(audio, deltaSeconds, currentMillis ^ esp_random());
  const bool controlChangedSettings =
      handleSerialControl(audio, currentMillis, currentMillis ^ esp_random());
  const bool shouldPersist = inputChangedSettings || controlChangedSettings ||
                             runtimeUpdate.sceneChanged || runtimeUpdate.variationChanged;
  if (shouldPersist) {
    saveSettings();
  }
  updateBody(audio, runtime.variation());

  const float elapsedSeconds = static_cast<float>(currentMillis) / 1000.0F;
  const float hue = runtime.settings().hueMode == stackchan::HueMode::Fixed
                        ? runtime.settings().fixedHue
                        : elapsedSeconds * 12.0F * runtime.variation().speed;
  sceneRenderer.draw(canvas, runtime.settings().scene, audio, runtime.variation(), elapsedSeconds,
                     deltaSeconds, hue);
  frameBuffer.pushSprite(0, 0);
}
