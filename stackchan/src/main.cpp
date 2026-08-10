// clang-format off
// M5GFXは先にFS_Hが定義された場合だけファイル描画overloadを提供する。
#include <SD.h>
#include <M5StackChan.h>
// clang-format on
#include <Preferences.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

#include "visualizer/audio.hpp"
#include "visualizer/control.hpp"
#include "visualizer/headbang.hpp"
#include "visualizer/runtime.hpp"
#include "visualizer/scene_renderer.hpp"

namespace {

constexpr std::uint32_t kSampleRate = 16000;
constexpr std::size_t kSampleCount = 256;
constexpr std::size_t kMaximumControlLine = 65536;
constexpr const char* kImageDirectory = "/vj-images";

std::array<std::int16_t, kSampleCount> samples{};
stackchan::AudioAnalyzer analyzer;
stackchan::AnalyzedAudioFrame analyzedAudio{};
stackchan::RuntimeController runtime;
stackchan::ControlService controlService(runtime, analyzer);
stackchan::HeadbangController headbangController;
stackchan::SceneRenderer sceneRenderer;
M5Canvas frameBuffer(&M5StackChan.Display());
Preferences preferences;
std::uint32_t previousMillis = 0;
std::uint32_t lastLedUpdateMs = 0;
std::string controlLine;
bool discardingControlLine = false;
bool imageStorageReady = false;
bool microphoneCapturePending = false;
bool hasLedColor = false;
std::uint16_t lastLedColor = 0;
float frameBufferScale = 1.0F;

struct PerformanceWindow {
  std::uint32_t startedAtMs = 0;
  std::uint32_t frameCount = 0;
  std::uint64_t logicMicros = 0;
  std::uint64_t audioMicros = 0;
  std::uint64_t renderMicros = 0;
  std::uint64_t presentMicros = 0;
  std::uint64_t totalMicros = 0;
};

PerformanceWindow performance;

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

  bool image(const stackchan::ImageAsset& asset, int x, int y, int width, int height) override {
    const bool isJpeg = asset.mime == "image/jpeg" || asset.mime == "image/jpg";
    const bool usesPersistedFile = imageStorageReady && !asset.storagePath.empty();
    const bool drawsPersistedJpeg = usesPersistedFile && isJpeg;
    if (drawsPersistedJpeg) {
      return canvas_.drawJpgFile(SD, asset.storagePath.c_str(), x, y, width, height);
    }
    const bool isPng = asset.mime == "image/png";
    const bool drawsPersistedPng = usesPersistedFile && isPng;
    if (drawsPersistedPng) {
      return canvas_.drawPngFile(SD, asset.storagePath.c_str(), x, y, width, height);
    }
    if (isJpeg) {
      return canvas_.drawJpg(asset.bytes.data(), asset.bytes.size(), x, y, width, height);
    }
    if (isPng) {
      return canvas_.drawPng(asset.bytes.data(), asset.bytes.size(), x, y, width, height);
    }
    return false;
  }

private:
  M5Canvas& canvas_;
};

M5CanvasAdapter canvas(frameBuffer);

void setFrameBufferScale(float scale) {
  const float safeScale = std::clamp(scale, 0.5F, 1.0F);
  const bool alreadyConfigured = std::abs(frameBufferScale - safeScale) < 0.001F;
  if (alreadyConfigured) {
    return;
  }
  frameBuffer.deleteSprite();
  frameBufferScale = safeScale;
  const int width = std::max(1, static_cast<int>(std::round(320.0F * safeScale)));
  const int height = std::max(1, static_cast<int>(std::round(240.0F * safeScale)));
  frameBuffer.createSprite(width, height);
  frameBuffer.setPivot(width / 2, height / 2);
}

void presentFrameBuffer() {
  const bool usesNativeResolution = std::abs(frameBufferScale - 1.0F) < 0.001F;
  if (usesNativeResolution) {
    frameBuffer.pushSprite(0, 0);
    return;
  }
  M5StackChan.Display().setPivot(160, 120);
  const float zoom = 1.0F / frameBufferScale;
  frameBuffer.pushRotateZoom(&M5StackChan.Display(), 160.0F, 120.0F, 0.0F, zoom, zoom);
}

void observePerformance(std::uint32_t nowMs, std::uint32_t logicMicros, std::uint32_t audioMicros,
                        std::uint32_t renderMicros, std::uint32_t presentMicros,
                        std::uint32_t totalMicros) {
  const bool needsWindowStart = performance.startedAtMs == 0;
  if (needsWindowStart) {
    performance.startedAtMs = nowMs;
  }
  ++performance.frameCount;
  performance.logicMicros += logicMicros;
  performance.audioMicros += audioMicros;
  performance.renderMicros += renderMicros;
  performance.presentMicros += presentMicros;
  performance.totalMicros += totalMicros;

  constexpr std::uint32_t kPerformanceWindowMs = 2000;
  const std::uint32_t elapsedMs = nowMs - performance.startedAtMs;
  const bool completedWindow = elapsedMs >= kPerformanceWindowMs;
  if (!completedWindow) {
    return;
  }
  const float frames = static_cast<float>(performance.frameCount);
  const float fps = frames * 1000.0F / static_cast<float>(elapsedMs);
  Serial.printf("{\"event\":\"performance\",\"fps\":%.2f,\"frameMs\":%.2f,\"logicMs\":%.2f,"
                "\"audioMs\":%.2f,\"renderMs\":%.2f,\"presentMs\":%.2f,\"qualityScale\":%.2f,"
                "\"scene\":\"%s\"}\n",
                fps, static_cast<float>(performance.totalMicros) / frames / 1000.0F,
                static_cast<float>(performance.logicMicros) / frames / 1000.0F,
                static_cast<float>(performance.audioMicros) / frames / 1000.0F,
                static_cast<float>(performance.renderMicros) / frames / 1000.0F,
                static_cast<float>(performance.presentMicros) / frames / 1000.0F,
                runtime.qualityScale(), stackchan::sceneId(runtime.settings().scene));
  performance = {};
  performance.startedAtMs = nowMs;
}

std::string imageExtension(const std::string& mime) {
  return mime == "image/png" ? ".png" : ".jpg";
}

std::string imageMimeFromPath(const std::string& path) {
  const bool isPng = path.size() >= 4U && path.substr(path.size() - 4U) == ".png";
  return isPng ? "image/png" : "image/jpeg";
}

bool persistLatestImage() {
  const stackchan::ImageAsset* asset = controlService.images().latest();
  const bool hasMemoryAsset = asset != nullptr && !asset->bytes.empty();
  const bool cannotPersistImage = !imageStorageReady || !hasMemoryAsset;
  if (cannotPersistImage) {
    return false;
  }
  const std::string path =
      std::string{kImageDirectory} + "/" + asset->hash + imageExtension(asset->mime);
  const bool isAlreadyPersisted = SD.exists(path.c_str());
  if (isAlreadyPersisted) {
    return controlService.images().markPersisted(asset->hash, path);
  }
  File file = SD.open(path.c_str(), FILE_WRITE);
  const bool didOpen = static_cast<bool>(file);
  const bool failedToOpen = !didOpen;
  if (failedToOpen) {
    return false;
  }
  const std::size_t byteCount = asset->bytes.size();
  const bool didWrite = file.write(asset->bytes.data(), byteCount) == byteCount;
  file.close();
  const bool failedToWrite = !didWrite;
  if (failedToWrite) {
    SD.remove(path.c_str());
    return false;
  }
  return controlService.images().markPersisted(asset->hash, path);
}

void loadPersistedImages() {
  const int chipSelect = M5.getPin(m5::pin_name_t::sd_spi_cs);
  imageStorageReady = chipSelect >= 0 && SD.begin(chipSelect, SPI, 25000000);
  const bool storageUnavailable = !imageStorageReady;
  if (storageUnavailable) {
    return;
  }
  const bool needsImageDirectory = !SD.exists(kImageDirectory);
  if (needsImageDirectory) {
    SD.mkdir(kImageDirectory);
  }
  File directory = SD.open(kImageDirectory);
  const bool hasDirectory = static_cast<bool>(directory) && directory.isDirectory();
  const bool directoryUnavailable = !hasDirectory;
  if (directoryUnavailable) {
    return;
  }
  File file = directory.openNextFile();
  while (file) {
    const bool canLoad =
        !file.isDirectory() && file.size() > 0U && file.size() <= 5U * 1024U * 1024U;
    if (canLoad) {
      const std::string path = file.path();
      std::vector<std::uint8_t> bytes(file.size());
      const bool didRead = file.read(bytes.data(), bytes.size()) == bytes.size();
      if (didRead) {
        const auto stored = controlService.images().putBytes(file.name(), std::move(bytes),
                                                             imageMimeFromPath(path));
        const bool restored = stored.ok && stored.asset != nullptr;
        if (restored) {
          controlService.images().markPersisted(stored.asset->hash, path);
        }
      }
    }
    file.close();
    file = directory.openNextFile();
  }
  directory.close();
}

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
  const bool captureStillRunning = microphoneCapturePending && M5.Mic.isRecording() > 0;
  if (captureStillRunning) {
    return analyzedAudio;
  }
  if (microphoneCapturePending) {
    analyzedAudio = analyzer.process(samples.data(), samples.size(), kSampleRate,
                                     runtime.settings().gain, nowMs);
    microphoneCapturePending = false;
  }
  const bool didStartCapture = M5.Mic.record(samples.data(), samples.size(), kSampleRate);
  if (didStartCapture) {
    microphoneCapturePending = true;
    return analyzedAudio;
  }
  return analyzer.process(nullptr, 0, kSampleRate, runtime.settings().gain, nowMs);
}

void updateBody(const stackchan::AnalyzedAudioFrame& audio, const stackchan::Variation& variation,
                std::uint32_t nowMs) {
  const auto ledColor =
      stackchan::hsl(variation.hueOffset + audio.tempo.barPhase * 360.0F, variation.saturation,
                     4.0F + audio.level * 42.0F + audio.beatIntensity * 28.0F);
  const std::uint16_t packedLedColor = toRgb565(ledColor);
  constexpr std::uint32_t kLedUpdateIntervalMs = 50;
  const bool isLedUpdateDue = nowMs - lastLedUpdateMs >= kLedUpdateIntervalMs;
  const bool didLedColorChange = !hasLedColor || packedLedColor != lastLedColor;
  const bool shouldRefreshLeds = isLedUpdateDue && didLedColorChange;
  if (shouldRefreshLeds) {
    M5StackChan.showRgbColor(ledColor.red, ledColor.green, ledColor.blue);
    lastLedUpdateMs = nowMs;
    lastLedColor = packedLedColor;
    hasLedColor = true;
  }

  const auto headbang = headbangController.update(audio.tempo, audio.beatIntensity);
  const bool shouldMoveHead = headbang.shouldMove;
  if (shouldMoveHead) {
    M5StackChan.Motion.move(headbang.yaw, headbang.pitch, headbang.speed);
    analyzer.suppressMotionNoise(nowMs);
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
  const auto result = controlService.dispatch(request, audio, nowMs, entropy);
  Serial.println(result.response.c_str());
  const bool shouldPersistImage = result.imageChanged;
  if (shouldPersistImage) {
    persistLatestImage();
  }
  return result.settingsChanged;
}

bool handleSerialControl(const stackchan::AnalyzedAudioFrame& audio, std::uint32_t nowMs,
                         std::uint32_t entropy) {
  bool settingsChanged = false;
  while (Serial.available() > 0) {
    const char character = static_cast<char>(Serial.read());
    const bool endsLine = character == '\n';
    const bool ignoresCarriageReturn = character == '\r';
    if (endsLine) {
      if (discardingControlLine) {
        discardingControlLine = false;
        controlLine.clear();
        continue;
      }
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
    if (discardingControlLine) {
      continue;
    }
    const bool hasCapacity = controlLine.size() < kMaximumControlLine;
    if (hasCapacity) {
      controlLine.push_back(character);
    } else {
      controlLine.clear();
      discardingControlLine = true;
      controlService.images().cancelBase64();
      Serial.println(stackchan::encodeControlError(0, "request exceeds 65536 bytes").c_str());
    }
  }
  return settingsChanged;
}

} // namespace

void setup() {
  Serial.begin(921600);
  M5StackChan.begin();
  M5StackChan.Motion.setAutoAngleSyncEnabled(false);
  loadPersistedImages();
  preferences.begin("visualizer", false);
  runtime.setSettings(loadSettings());
  M5StackChan.Display().setRotation(1);
  frameBuffer.setColorDepth(16);
  frameBuffer.createSprite(320, 240);
  frameBuffer.setPivot(160, 120);

  auto microphoneConfig = M5.Mic.config();
  microphoneConfig.sample_rate = kSampleRate;
  M5.Mic.config(microphoneConfig);
  M5.Mic.begin();
  previousMillis = millis();
}

void loop() {
  const std::uint32_t loopStartedAtMicros = micros();
  M5StackChan.update();
  const std::uint32_t currentMillis = millis();
  const float deltaSeconds =
      std::min(static_cast<float>(currentMillis - previousMillis) / 1000.0F, 0.1F);
  previousMillis = currentMillis;

  const bool inputChangedSettings = handleInput(currentMillis ^ esp_random(), currentMillis);
  const std::uint32_t audioStartedAtMicros = micros();
  const auto audio = readAudio(currentMillis);
  const std::uint32_t audioFinishedAtMicros = micros();
  const bool timelineChangedSettings =
      controlService.updateTimeline(audio, static_cast<double>(currentMillis) / 1000.0);
  const auto runtimeUpdate = runtime.update(audio, deltaSeconds, currentMillis ^ esp_random());
  const bool controlChangedSettings =
      handleSerialControl(audio, currentMillis, currentMillis ^ esp_random());
  const bool shouldPersist = inputChangedSettings || controlChangedSettings ||
                             timelineChangedSettings || runtimeUpdate.sceneChanged ||
                             runtimeUpdate.variationChanged;
  if (shouldPersist) {
    saveSettings();
  }
  updateBody(audio, runtime.variation(), currentMillis);
  setFrameBufferScale(runtime.qualityScale());

  const float elapsedSeconds = static_cast<float>(currentMillis) / 1000.0F;
  const float hue = runtime.settings().hueMode == stackchan::HueMode::Fixed
                        ? runtime.settings().fixedHue
                        : elapsedSeconds * 12.0F * runtime.variation().speed;
  const std::uint32_t renderStartedAtMicros = micros();
  sceneRenderer.draw(canvas, runtime.settings().scene, audio, runtime.variation(), elapsedSeconds,
                     deltaSeconds, hue, runtime.patchJson(), &controlService.images(),
                     runtime.settings().background, runtime.previousPatchJson(),
                     runtime.patchTransitionProgress());
  const std::uint32_t renderFinishedAtMicros = micros();
  presentFrameBuffer();
  const std::uint32_t loopFinishedAtMicros = micros();
  const std::uint32_t audioMicros = audioFinishedAtMicros - audioStartedAtMicros;
  const std::uint32_t renderMicros = renderFinishedAtMicros - renderStartedAtMicros;
  const std::uint32_t presentMicros = loopFinishedAtMicros - renderFinishedAtMicros;
  const std::uint32_t totalMicros = loopFinishedAtMicros - loopStartedAtMicros;
  const std::uint32_t logicMicros = totalMicros - audioMicros - renderMicros - presentMicros;
  observePerformance(currentMillis, logicMicros, audioMicros, renderMicros, presentMicros,
                     totalMicros);
}
