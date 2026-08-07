#pragma once

#include "visualizer/audio.hpp"
#include "visualizer/runtime.hpp"

#include <cstdint>
#include <string>

namespace stackchan {

enum class ControlMethod {
  GetState,
  ProposeSeed,
  SetScene,
  ShiftScene,
  Reroll,
  TapTempo,
  TempoMultiply,
  TempoAuto,
  Unknown,
};

struct ControlRequest {
  std::uint32_t id = 0;
  ControlMethod method = ControlMethod::Unknown;
  std::string text;
  float number = 0.0F;
  bool ok = false;
  std::string issue;
};

struct ControlSnapshot {
  const Settings* settings = nullptr;
  const TempoState* tempo = nullptr;
  bool transitionActive = false;
  double nowSec = 0.0;
};

[[nodiscard]] ControlRequest parseControlRequest(const std::string& json);
[[nodiscard]] std::string encodeControlError(std::uint32_t id, const std::string& issue);
[[nodiscard]] std::string encodeControlAck(std::uint32_t id);
[[nodiscard]] std::string encodeControlState(std::uint32_t id, const ControlSnapshot& snapshot);

} // namespace stackchan
