#include "visualizer/audio.hpp"
#include "visualizer/control.hpp"
#include "visualizer/runtime.hpp"
#include "visualizer/scene_renderer.hpp"

#include <SDL.h>
#include <SDL_image.h>

#include <poll.h>
#include <unistd.h>

#include <algorithm>
#include <array>
#include <climits>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

constexpr int kWidth = 320;
constexpr int kHeight = 240;
constexpr std::uint32_t kSampleRate = 16000;

struct CommandLineOptions {
  std::string screenshotPath;
  std::string audioDevice;
  stackchan::SceneId scene = stackchan::SceneId::Bars;
  bool controlStdio = false;
  bool requireImage = false;
  bool listAudioDevices = false;
};

struct ControlInput {
  std::string line;
  bool discardingLine = false;
  bool reachedEnd = false;
};

CommandLineOptions parseCommandLine(int argumentCount, char** arguments) {
  CommandLineOptions options{};
  for (int index = 1; index < argumentCount; ++index) {
    const std::string argument = arguments[index];
    const bool hasValue = index + 1 < argumentCount;
    const bool setsScreenshot = argument == "--screenshot" && hasValue;
    const bool setsScene = argument == "--scene" && hasValue;
    const bool setsAudioDevice = argument == "--audio-device" && hasValue;
    const bool enablesControlStdio = argument == "--control-stdio";
    const bool requiresImage = argument == "--require-image";
    const bool listsAudioDevices = argument == "--list-audio-devices";
    if (setsScreenshot) {
      options.screenshotPath = arguments[++index];
    } else if (setsScene) {
      options.scene = stackchan::sceneFromId(arguments[++index]);
    } else if (setsAudioDevice) {
      options.audioDevice = arguments[++index];
    } else if (enablesControlStdio) {
      options.controlStdio = true;
    } else if (requiresImage) {
      options.requireImage = true;
    } else if (listsAudioDevices) {
      options.listAudioDevices = true;
    }
  }
  return options;
}

void dispatchControlLine(stackchan::ControlService& service,
                         const stackchan::AnalyzedAudioFrame& audio, std::uint32_t nowMs,
                         const std::string& line) {
  const auto request = stackchan::parseControlRequest(line);
  const auto result = service.dispatch(request, audio, nowMs, nowMs ^ 0x9E3779B9U);
  std::cout << result.response << '\n' << std::flush;
}

void consumeControlBytes(stackchan::ControlService& service,
                         const stackchan::AnalyzedAudioFrame& audio, std::uint32_t nowMs,
                         ControlInput& input, const char* bytes, std::size_t count) {
  constexpr std::size_t kMaximumControlLine = 8U * 1024U * 1024U;
  for (std::size_t index = 0; index < count; ++index) {
    const char character = bytes[index];
    const bool endsLine = character == '\n';
    if (endsLine) {
      const bool hasCompleteLine = !input.discardingLine && !input.line.empty();
      if (hasCompleteLine) {
        dispatchControlLine(service, audio, nowMs, input.line);
      }
      input.line.clear();
      input.discardingLine = false;
      continue;
    }
    const bool ignoresCarriageReturn = character == '\r';
    const bool ignoresCharacter = ignoresCarriageReturn || input.discardingLine;
    if (ignoresCharacter) {
      continue;
    }
    const bool hasCapacity = input.line.size() < kMaximumControlLine;
    if (hasCapacity) {
      input.line.push_back(character);
    } else {
      input.line.clear();
      input.discardingLine = true;
      service.images().cancelBase64();
      std::cout << stackchan::encodeControlError(0, "request exceeds 8 MiB") << '\n' << std::flush;
    }
  }
}

void pollControlStdio(stackchan::ControlService& service,
                      const stackchan::AnalyzedAudioFrame& audio, std::uint32_t nowMs,
                      ControlInput& input) {
  pollfd descriptor{STDIN_FILENO, static_cast<short>(POLLIN | POLLHUP), 0};
  const int ready = poll(&descriptor, 1, 0);
  const bool hasInput = ready > 0 && (descriptor.revents & POLLIN) != 0;
  const bool hasHangup = ready > 0 && (descriptor.revents & POLLHUP) != 0;
  bool reachedEnd = false;
  const bool canRead = hasInput || hasHangup;
  if (canRead) {
    std::array<char, 4096> bytes{};
    ssize_t count = 0;
    do {
      count = read(STDIN_FILENO, bytes.data(), bytes.size());
      const bool readBytes = count > 0;
      if (!readBytes) {
        reachedEnd = count == 0;
        continue;
      }
      consumeControlBytes(service, audio, nowMs, input, bytes.data(),
                          static_cast<std::size_t>(count));
    } while (hasHangup && count > 0);
  }
  const bool inputFinished = hasHangup || reachedEnd;
  if (inputFinished) {
    const bool hasPendingLine = !input.discardingLine && !input.line.empty();
    if (hasPendingLine) {
      dispatchControlLine(service, audio, nowMs, input.line);
      input.line.clear();
    }
    input.reachedEnd = true;
  }
}

void writeLittleEndian(std::ofstream& output, std::uint32_t value, int byteCount) {
  for (int index = 0; index < byteCount; ++index) {
    output.put(static_cast<char>((value >> (index * 8)) & 0xFFU));
  }
}

bool saveScreenshot(const std::vector<std::uint8_t>& pixels, const std::string& path) {
  constexpr int kBytesPerPixel = 4;
  const int pitch = kWidth * kBytesPerPixel;
  const bool hasExpectedSize = pixels.size() == static_cast<std::size_t>(pitch * kHeight);
  if (!hasExpectedSize) {
    return false;
  }

  std::ofstream output(path, std::ios::binary);
  const bool didOpen = output.is_open();
  if (!didOpen) {
    return false;
  }

  constexpr std::uint32_t kHeaderSize = 54;
  const std::uint32_t imageSize = static_cast<std::uint32_t>(pixels.size());
  output.write("BM", 2);
  writeLittleEndian(output, kHeaderSize + imageSize, 4);
  writeLittleEndian(output, 0, 4);
  writeLittleEndian(output, kHeaderSize, 4);
  writeLittleEndian(output, 40, 4);
  writeLittleEndian(output, kWidth, 4);
  writeLittleEndian(output, kHeight, 4);
  writeLittleEndian(output, 1, 2);
  writeLittleEndian(output, 32, 2);
  writeLittleEndian(output, 0, 4);
  writeLittleEndian(output, imageSize, 4);
  writeLittleEndian(output, 2835, 4);
  writeLittleEndian(output, 2835, 4);
  writeLittleEndian(output, 0, 4);
  writeLittleEndian(output, 0, 4);
  for (int y = kHeight - 1; y >= 0; --y) {
    const auto* row = pixels.data() + static_cast<std::size_t>(y * pitch);
    output.write(reinterpret_cast<const char*>(row), pitch);
  }
  return output.good();
}

class SdlCanvas final : public stackchan::Canvas {
public:
  explicit SdlCanvas(SDL_Renderer* renderer) : renderer_(renderer) {}
  ~SdlCanvas() override { releaseImages(); }

  void releaseImages() {
    for (const auto& item : imageSurfaces_) {
      SDL_FreeSurface(item.second);
    }
    imageSurfaces_.clear();
  }

  [[nodiscard]] int successfulImageDraws() const { return successfulImageDraws_; }

  void setResolutionScale(float scale) {
    const float safeScale = std::clamp(scale, 0.5F, 1.0F);
    logicalWidth_ = std::max(1, static_cast<int>(std::round(kWidth * safeScale)));
    logicalHeight_ = std::max(1, static_cast<int>(std::round(kHeight * safeScale)));
    SDL_RenderSetLogicalSize(renderer_, logicalWidth_, logicalHeight_);
  }

  [[nodiscard]] int width() const override { return logicalWidth_; }
  [[nodiscard]] int height() const override { return logicalHeight_; }

  void clear(stackchan::Color color) override {
    setColor(color);
    SDL_RenderClear(renderer_);
  }

  void line(int x1, int y1, int x2, int y2, stackchan::Color color, int thickness) override {
    setColor(color);
    const int safeThickness = std::max(1, thickness);
    for (int offset = 0; offset < safeThickness; ++offset) {
      SDL_RenderDrawLine(renderer_, x1, y1 + offset, x2, y2 + offset);
    }
  }

  void rectangle(int x, int y, int width, int height, stackchan::Color color,
                 bool filled) override {
    const bool hasArea = width > 0 && height > 0;
    if (!hasArea) {
      return;
    }
    setColor(color);
    SDL_Rect rectangle{x, y, width, height};
    if (filled) {
      SDL_RenderFillRect(renderer_, &rectangle);
    } else {
      SDL_RenderDrawRect(renderer_, &rectangle);
    }
  }

  void circle(int x, int y, int radius, stackchan::Color color, bool filled) override {
    const bool hasRadius = radius > 0;
    if (!hasRadius) {
      return;
    }
    setColor(color);
    if (filled) {
      for (int offsetY = -radius; offsetY <= radius; ++offsetY) {
        const int halfWidth = static_cast<int>(std::sqrt(radius * radius - offsetY * offsetY));
        SDL_RenderDrawLine(renderer_, x - halfWidth, y + offsetY, x + halfWidth, y + offsetY);
      }
      return;
    }
    int pointX = radius;
    int pointY = 0;
    int error = 1 - radius;
    while (pointX >= pointY) {
      const std::array<SDL_Point, 8> points = {
          SDL_Point{x + pointX, y + pointY}, SDL_Point{x + pointY, y + pointX},
          SDL_Point{x - pointY, y + pointX}, SDL_Point{x - pointX, y + pointY},
          SDL_Point{x - pointX, y - pointY}, SDL_Point{x - pointY, y - pointX},
          SDL_Point{x + pointY, y - pointX}, SDL_Point{x + pointX, y - pointY},
      };
      SDL_RenderDrawPoints(renderer_, points.data(), static_cast<int>(points.size()));
      ++pointY;
      const bool crossesBoundary = error < 0;
      if (crossesBoundary) {
        error += 2 * pointY + 1;
      } else {
        --pointX;
        error += 2 * (pointY - pointX) + 1;
      }
    }
  }

  void text(int x, int y, const std::string& value, stackchan::Color color) override {
    setColor(color);
    for (std::size_t index = 0; index < value.size(); ++index) {
      SDL_Rect glyph{x + static_cast<int>(index) * 5, y, 3, 5};
      SDL_RenderDrawRect(renderer_, &glyph);
    }
  }

  bool image(const stackchan::ImageAsset& asset, int x, int y, int width, int height) override {
    SDL_Surface* surface = nullptr;
    const auto cached = imageSurfaces_.find(asset.hash);
    const bool hasCachedSurface = cached != imageSurfaces_.end();
    if (hasCachedSurface) {
      surface = cached->second;
    } else {
      const bool fitsDecoder = asset.bytes.size() <= static_cast<std::size_t>(INT_MAX);
      if (!fitsDecoder) {
        return false;
      }
      SDL_RWops* data =
          SDL_RWFromConstMem(asset.bytes.data(), static_cast<int>(asset.bytes.size()));
      const bool hasData = data != nullptr;
      if (!hasData) {
        return false;
      }
      surface = IMG_Load_RW(data, 1);
      const bool decoded = surface != nullptr;
      if (!decoded) {
        return false;
      }
      imageSurfaces_.emplace(asset.hash, surface);
    }
    SDL_Texture* texture = SDL_CreateTextureFromSurface(renderer_, surface);
    const bool hasTexture = texture != nullptr;
    if (!hasTexture) {
      return false;
    }
    const float scale =
        std::min(static_cast<float>(width) / surface->w, static_cast<float>(height) / surface->h);
    const int drawWidth = std::max(1, static_cast<int>(std::round(surface->w * scale)));
    const int drawHeight = std::max(1, static_cast<int>(std::round(surface->h * scale)));
    SDL_Rect target{x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth,
                    drawHeight};
    const bool didDraw = SDL_RenderCopy(renderer_, texture, nullptr, &target) == 0;
    SDL_DestroyTexture(texture);
    if (didDraw) {
      ++successfulImageDraws_;
    }
    return didDraw;
  }

private:
  void setColor(stackchan::Color color) {
    SDL_SetRenderDrawBlendMode(renderer_,
                               color.alpha < 255 ? SDL_BLENDMODE_BLEND : SDL_BLENDMODE_NONE);
    SDL_SetRenderDrawColor(renderer_, color.red, color.green, color.blue, color.alpha);
  }

  SDL_Renderer* renderer_;
  int logicalWidth_ = kWidth;
  int logicalHeight_ = kHeight;
  std::unordered_map<std::string, SDL_Surface*> imageSurfaces_;
  int successfulImageDraws_ = 0;
};

void fillSyntheticAudio(std::array<std::int16_t, 256>& samples, float seconds) {
  const float pulse = std::pow(std::max(0.0F, std::sin(seconds * 4.0F)), 5.0F);
  for (std::size_t index = 0; index < samples.size(); ++index) {
    const float time = seconds + static_cast<float>(index) / kSampleRate;
    const float bass = std::sin(time * 2.0F * 3.14159265F * 110.0F) * (0.12F + pulse * 0.55F);
    const float mid = std::sin(time * 2.0F * 3.14159265F * 660.0F) * 0.12F;
    const float treble = std::sin(time * 2.0F * 3.14159265F * 3200.0F) * 0.05F;
    samples[index] =
        static_cast<std::int16_t>(std::clamp(bass + mid + treble, -1.0F, 1.0F) * 32767.0F);
  }
}

} // namespace

int main(int argumentCount, char** arguments) {
  const CommandLineOptions options = parseCommandLine(argumentCount, arguments);
  const bool takesScreenshot = !options.screenshotPath.empty();
  const bool usesAudioCapture = !options.audioDevice.empty() || options.listAudioDevices;
  const std::uint32_t sdlSystems =
      SDL_INIT_VIDEO | SDL_INIT_TIMER | (usesAudioCapture ? SDL_INIT_AUDIO : 0U);
  const bool didInitialize = SDL_Init(sdlSystems) == 0;
  if (!didInitialize) {
    return 1;
  }
  const bool shouldListAudioDevices = options.listAudioDevices;
  if (shouldListAudioDevices) {
    const int count = SDL_GetNumAudioDevices(SDL_TRUE);
    for (int index = 0; index < count; ++index) {
      std::cout << index << '\t' << SDL_GetAudioDeviceName(index, SDL_TRUE) << '\n';
    }
    SDL_Quit();
    return count < 0 ? 1 : 0;
  }
  const int requestedImageFormats = IMG_INIT_JPG | IMG_INIT_PNG;
  const int initializedImageFormats = IMG_Init(requestedImageFormats);
  const bool hasImageDecoders =
      (initializedImageFormats & requestedImageFormats) == requestedImageFormats;
  if (!hasImageDecoders) {
    IMG_Quit();
    SDL_Quit();
    return 1;
  }
  constexpr int kBytesPerPixel = 4;
  constexpr int kScreenshotPitch = kWidth * kBytesPerPixel;
  std::vector<std::uint8_t> screenshotPixels(
      takesScreenshot ? static_cast<std::size_t>(kScreenshotPitch * kHeight) : 0);
  SDL_Surface* screenshotSurface = nullptr;
  SDL_Window* window = nullptr;
  SDL_Renderer* renderer = nullptr;
  if (takesScreenshot) {
    screenshotSurface = SDL_CreateRGBSurfaceWithFormatFrom(
        screenshotPixels.data(), kWidth, kHeight, 32, kScreenshotPitch, SDL_PIXELFORMAT_ARGB8888);
    const bool hasSurface = screenshotSurface != nullptr;
    if (hasSurface) {
      renderer = SDL_CreateSoftwareRenderer(screenshotSurface);
    }
  } else {
    window = SDL_CreateWindow("Stack-chan CoreS3 Simulator", SDL_WINDOWPOS_CENTERED,
                              SDL_WINDOWPOS_CENTERED, kWidth * 2, kHeight * 2,
                              SDL_WINDOW_ALLOW_HIGHDPI | SDL_WINDOW_RESIZABLE);
    const bool hasWindow = window != nullptr;
    if (hasWindow) {
      renderer = SDL_CreateRenderer(window, -1, SDL_RENDERER_ACCELERATED);
      const bool needsSoftwareFallback = renderer == nullptr;
      if (needsSoftwareFallback) {
        renderer = SDL_CreateRenderer(window, -1, SDL_RENDERER_SOFTWARE);
      }
    }
  }
  const bool hasRenderer = renderer != nullptr;
  if (!hasRenderer) {
    SDL_FreeSurface(screenshotSurface);
    SDL_DestroyWindow(window);
    IMG_Quit();
    SDL_Quit();
    return 1;
  }
  SDL_RenderSetLogicalSize(renderer, kWidth, kHeight);

  SDL_AudioDeviceID audioDevice = 0;
  const bool shouldOpenAudioCapture = usesAudioCapture;
  if (shouldOpenAudioCapture) {
    SDL_AudioSpec desired{};
    desired.freq = static_cast<int>(kSampleRate);
    desired.format = AUDIO_S16SYS;
    desired.channels = 1;
    desired.samples = 256;
    const char* requestedDevice =
        options.audioDevice == "default" ? nullptr : options.audioDevice.c_str();
    audioDevice = SDL_OpenAudioDevice(requestedDevice, SDL_TRUE, &desired, nullptr, 0);
    const bool didOpenAudio = audioDevice != 0;
    if (!didOpenAudio) {
      SDL_DestroyRenderer(renderer);
      SDL_FreeSurface(screenshotSurface);
      SDL_DestroyWindow(window);
      IMG_Quit();
      SDL_Quit();
      return 1;
    }
    SDL_PauseAudioDevice(audioDevice, 0);
  }

  SdlCanvas canvas(renderer);
  stackchan::SceneRenderer sceneRenderer;
  stackchan::AudioAnalyzer analyzer;
  stackchan::Settings settings{};
  settings.scene = options.scene;
  stackchan::RuntimeController runtime(settings);
  stackchan::ControlService controlService(runtime, analyzer);
  ControlInput controlInput{};
  std::array<std::int16_t, 256> samples{};
  std::uint32_t previousTicks = SDL_GetTicks();
  bool isRunning = true;
  while (isRunning) {
    SDL_Event event{};
    while (SDL_PollEvent(&event) != 0) {
      const bool didQuit = event.type == SDL_QUIT;
      const bool didPressEscape = event.type == SDL_KEYDOWN && event.key.keysym.sym == SDLK_ESCAPE;
      const bool shouldStop = didQuit || didPressEscape;
      if (shouldStop) {
        isRunning = false;
      }
      const bool didPressKey = event.type == SDL_KEYDOWN;
      if (didPressKey) {
        const SDL_Keycode key = event.key.keysym.sym;
        const bool wantsNext = key == SDLK_RIGHT;
        const bool wantsPrevious = key == SDLK_LEFT;
        const bool wantsReroll = key == SDLK_r;
        const bool wantsTap = key == SDLK_t;
        if (wantsNext) {
          runtime.shiftScene(1);
        } else if (wantsPrevious) {
          runtime.shiftScene(-1);
        } else if (wantsReroll) {
          runtime.reroll(SDL_GetTicks());
        } else if (wantsTap) {
          analyzer.tapTempo(SDL_GetTicks());
        }
      }
    }

    const std::uint32_t currentTicks = takesScreenshot ? 3000U : SDL_GetTicks();
    const float deltaSeconds = static_cast<float>(currentTicks - previousTicks) / 1000.0F;
    previousTicks = currentTicks;
    const float elapsedSeconds = static_cast<float>(currentTicks) / 1000.0F;
    std::size_t sampleCount = samples.size();
    const bool shouldReadAudioCapture = usesAudioCapture;
    if (shouldReadAudioCapture) {
      const std::uint32_t byteCount =
          SDL_DequeueAudio(audioDevice, samples.data(), samples.size() * sizeof(samples[0]));
      sampleCount = byteCount / sizeof(samples[0]);
    } else {
      fillSyntheticAudio(samples, elapsedSeconds);
    }
    const std::int16_t* sampleData = sampleCount > 0U ? samples.data() : nullptr;
    const auto audio = analyzer.process(sampleData, sampleCount, kSampleRate,
                                        runtime.settings().gain, currentTicks);
    controlService.updateTimeline(audio, elapsedSeconds);
    const bool usesControlStdio = options.controlStdio;
    if (usesControlStdio) {
      pollControlStdio(controlService, audio, currentTicks, controlInput);
    }
    runtime.update(audio, deltaSeconds, currentTicks);
    canvas.setResolutionScale(runtime.qualityScale());
    const float hue = runtime.settings().hueMode == stackchan::HueMode::Fixed
                          ? runtime.settings().fixedHue
                          : elapsedSeconds * 12.0F * runtime.variation().speed;
    sceneRenderer.draw(canvas, runtime.settings().scene, audio, runtime.variation(), elapsedSeconds,
                       deltaSeconds, hue, runtime.patchJson(), &controlService.images(),
                       runtime.settings().background, runtime.previousPatchJson(),
                       runtime.patchTransitionProgress());
    if (takesScreenshot) {
      const bool didSave = saveScreenshot(screenshotPixels, options.screenshotPath);
      if (!didSave) {
        std::cerr << "failed to save screenshot: " << SDL_GetError() << '\n';
        isRunning = false;
        canvas.releaseImages();
        const bool hasAudioDevice = audioDevice != 0;
        if (hasAudioDevice) {
          SDL_CloseAudioDevice(audioDevice);
        }
        SDL_DestroyRenderer(renderer);
        SDL_FreeSurface(screenshotSurface);
        SDL_DestroyWindow(window);
        IMG_Quit();
        SDL_Quit();
        return 1;
      }
      isRunning = false;
    } else {
      SDL_RenderPresent(renderer);
    }
    const bool controlInputFinished = options.controlStdio && controlInput.reachedEnd;
    if (controlInputFinished) {
      isRunning = false;
    }
    SDL_Delay(16);
  }

  const bool imageRequirementFailed = options.requireImage && canvas.successfulImageDraws() == 0;
  canvas.releaseImages();

  const bool hasAudioDevice = audioDevice != 0;
  if (hasAudioDevice) {
    SDL_CloseAudioDevice(audioDevice);
  }
  SDL_DestroyRenderer(renderer);
  SDL_FreeSurface(screenshotSurface);
  SDL_DestroyWindow(window);
  IMG_Quit();
  SDL_Quit();
  return imageRequirementFailed ? 1 : 0;
}
