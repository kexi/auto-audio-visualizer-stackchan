#include "visualizer/visualizer.hpp"

#include <SDL.h>

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace {

constexpr int kWidth = 320;
constexpr int kHeight = 240;

stackchan::AudioFrame syntheticAudio(float seconds) {
  const float pulse = std::pow(std::max(0.0F, std::sin(seconds * 4.0F)), 5.0F);
  const float level = 0.25F + pulse * 0.7F;
  const float mid = 0.5F + std::sin(seconds * 1.7F) * 0.35F;
  const float treble = 0.5F + std::sin(seconds * 5.3F) * 0.4F;
  return {level, pulse, mid, treble};
}

void draw(SDL_Renderer* renderer, const stackchan::VisualizerState& state) {
  SDL_SetRenderDrawColor(renderer, 7, 10, 18, 255);
  SDL_RenderClear(renderer);

  SDL_SetRenderDrawColor(renderer, 48, 220, 210, 255);
  const int eyeHeight = std::max(3, 18 - static_cast<int>(state.eyeSquint * 14.0F));
  SDL_Rect leftEye{76, 70 + (18 - eyeHeight) / 2, 52, eyeHeight};
  SDL_Rect rightEye{192, 70 + (18 - eyeHeight) / 2, 52, eyeHeight};
  SDL_RenderFillRect(renderer, &leftEye);
  SDL_RenderFillRect(renderer, &rightEye);

  const int mouthHeight = 4 + static_cast<int>(state.mouthOpen * 42.0F);
  SDL_Rect mouth{135, 116, 50, mouthHeight};
  SDL_RenderDrawRect(renderer, &mouth);

  const int barWidth = 18;
  for (std::size_t index = 0; index < state.bars.size(); ++index) {
    const int barHeight = 4 + static_cast<int>(state.bars[index] * 62.0F);
    SDL_Rect bar{21 + static_cast<int>(index) * 24, kHeight - 16 - barHeight, barWidth, barHeight};
    SDL_RenderFillRect(renderer, &bar);
  }

  SDL_RenderPresent(renderer);
}

} // namespace

int main() {
  const bool didInit = SDL_Init(SDL_INIT_VIDEO | SDL_INIT_TIMER) == 0;
  if (!didInit) {
    return 1;
  }

  SDL_Window* window =
      SDL_CreateWindow("Stack-chan Visualizer (CoreS3 320x240)", SDL_WINDOWPOS_CENTERED,
                       SDL_WINDOWPOS_CENTERED, kWidth * 2, kHeight * 2, SDL_WINDOW_ALLOW_HIGHDPI);
  if (window == nullptr) {
    SDL_Quit();
    return 1;
  }

  SDL_Renderer* renderer = SDL_CreateRenderer(window, -1, SDL_RENDERER_ACCELERATED);
  if (renderer == nullptr) {
    SDL_DestroyWindow(window);
    SDL_Quit();
    return 1;
  }
  SDL_RenderSetLogicalSize(renderer, kWidth, kHeight);

  stackchan::Visualizer visualizer;
  std::uint32_t previousTicks = SDL_GetTicks();
  bool isRunning = true;
  while (isRunning) {
    SDL_Event event{};
    while (SDL_PollEvent(&event) != 0) {
      const bool didQuit = event.type == SDL_QUIT;
      const bool didPressEscape = event.type == SDL_KEYDOWN && event.key.keysym.sym == SDLK_ESCAPE;
      if (didQuit || didPressEscape) {
        isRunning = false;
      }
    }

    const std::uint32_t currentTicks = SDL_GetTicks();
    const float deltaSeconds = static_cast<float>(currentTicks - previousTicks) / 1000.0F;
    previousTicks = currentTicks;
    const float elapsedSeconds = static_cast<float>(currentTicks) / 1000.0F;
    visualizer.update(syntheticAudio(elapsedSeconds), deltaSeconds);
    draw(renderer, visualizer.state());
    SDL_Delay(16);
  }

  SDL_DestroyRenderer(renderer);
  SDL_DestroyWindow(window);
  SDL_Quit();
  return 0;
}
