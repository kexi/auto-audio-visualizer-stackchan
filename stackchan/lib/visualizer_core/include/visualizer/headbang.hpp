#pragma once

#include <cstdint>

#include "visualizer/audio.hpp"

namespace stackchan {

struct HeadbangCommand {
  bool shouldMove = false;
  int yaw = 0;
  int pitch = 0;
  int speed = 0;
};

class HeadbangController {
public:
  [[nodiscard]] HeadbangCommand update(const TempoState& tempo, float beatIntensity);

private:
  std::uint64_t lastBeatNumber_ = 0;
  bool hasLastBeat_ = false;
};

} // namespace stackchan
