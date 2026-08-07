#pragma once

#include "visualizer/audio.hpp"
#include "visualizer/runtime.hpp"
#include "visualizer/timeline.hpp"

#include <cstdint>
#include <string>
#include <vector>

namespace stackchan {

enum class ControlMethod {
  GetState,
  ProposePatch,
  ProposeSeed,
  SetScene,
  ShiftScene,
  Reroll,
  TapTempo,
  TempoMultiply,
  TempoAuto,
  ApplyTimelineOp,
  FireExternal,
  StartRecording,
  StopRecording,
  LoadRecording,
  Unknown,
};

struct ControlRequest {
  std::uint32_t id = 0;
  ControlMethod method = ControlMethod::Unknown;
  std::string text;
  float number = 0.0F;
  TimelineOp timelineOperation{};
  SemanticIntent intent{};
  bool ok = false;
  std::string issue;
};

struct ControlSnapshot {
  const Settings* settings = nullptr;
  const TempoState* tempo = nullptr;
  const PerformanceTimeline* timeline = nullptr;
  const SchedulerState* scheduler = nullptr;
  const std::string* patchJson = nullptr;
  bool transitionActive = false;
  bool recordingActive = false;
  double nowSec = 0.0;
};

struct ControlResult {
  std::string response;
  bool settingsChanged = false;
};

class ControlService {
public:
  ControlService(RuntimeController& runtime, AudioAnalyzer& analyzer);

  [[nodiscard]] ControlResult dispatch(const ControlRequest& request,
                                       const AnalyzedAudioFrame& audio, std::uint64_t nowMs,
                                       std::uint32_t entropy);
  bool updateTimeline(const AnalyzedAudioFrame& audio, double nowSec);
  [[nodiscard]] const PerformanceTimeline& timeline() const;
  [[nodiscard]] const SchedulerState& scheduler() const;
  [[nodiscard]] bool recordingActive() const;

private:
  struct RecordedOperation {
    double atSec = 0.0;
    TimelineOp operation{};
  };

  struct FiredRecord {
    double atSec = 0.0;
    std::string eventId;
  };

  [[nodiscard]] TimeContext timeContext(const AnalyzedAudioFrame& audio, double nowSec) const;
  bool applyDueEvents(const std::vector<DueEvent>& dueEvents);

  RuntimeController& runtime_;
  AudioAnalyzer& analyzer_;
  PerformanceTimeline timeline_{};
  SchedulerState scheduler_{};
  bool recordingActive_ = false;
  std::string recordingInitialPatch_;
  std::string recordingSessionSeed_;
  std::vector<RecordedOperation> recordedOperations_;
  std::vector<FiredRecord> firedRecords_;
};

[[nodiscard]] ControlRequest parseControlRequest(const std::string& json);
[[nodiscard]] std::string encodeControlError(std::uint32_t id, const std::string& issue);
[[nodiscard]] std::string encodeControlAck(std::uint32_t id);
[[nodiscard]] std::string encodeTimelineResult(std::uint32_t id, const TimelineOpResult& result);
[[nodiscard]] std::string encodeControlState(std::uint32_t id, const ControlSnapshot& snapshot);

} // namespace stackchan
