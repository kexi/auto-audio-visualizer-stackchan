#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace stackchan {

enum class AnchorKind { Seconds, Bar, External };
enum class DurationKind { Seconds, Bars, UntilNext };
enum class TransitionEasing { Linear, EaseInOut };

struct TimeAnchor {
  AnchorKind kind = AnchorKind::Seconds;
  double value = 0.0;
  std::string externalId;
};

struct DurationSpec {
  DurationKind kind = DurationKind::UntilNext;
  double value = 0.0;
};

struct TransitionSpec {
  double paletteMs = 1200.0;
  double parameterMs = 800.0;
  double modulationMs = 1000.0;
  double topologyMs = 2000.0;
  TransitionEasing easing = TransitionEasing::EaseInOut;
};

struct SemanticIntent {
  std::string label;
  std::string seed;
  std::string patchJson;
};

struct VisualEvent {
  std::string id;
  TimeAnchor start{};
  DurationSpec duration{};
  SemanticIntent intent{};
  TransitionSpec transition{};
  float confidence = 1.0F;
  bool locked = false;
};

struct PerformanceTimeline {
  double lockedUntilSec = 0.0;
  std::vector<VisualEvent> events;
};

struct TimeContext {
  double nowSec = 0.0;
  std::uint32_t barCount = 0;
  float barPhase = 0.0F;
  float bpm = 0.0F;
  bool tempoLocked = false;
};

enum class TimelineOpKind {
  Add,
  Replace,
  Remove,
  SetIntent,
  SetTransition,
  Shift,
  SetLockedUntil,
};

struct TimelineOp {
  TimelineOpKind kind = TimelineOpKind::Add;
  std::string id;
  VisualEvent event{};
  SemanticIntent intent{};
  TransitionSpec transition{};
  TimeAnchor anchor{};
  double seconds = 0.0;
};

struct TimelineOpResult {
  bool ok = false;
  PerformanceTimeline timeline{};
  std::string issue;
};

struct SchedulerState {
  std::vector<std::string> firedIds;
};

struct DueEvent {
  VisualEvent event{};
  double firedAtSec = 0.0;
};

[[nodiscard]] std::optional<double> resolveAnchorSeconds(const TimeAnchor& anchor,
                                                         const TimeContext& context);
[[nodiscard]] TimelineOpResult applyTimelineOp(const PerformanceTimeline& timeline,
                                               const TimelineOp& operation,
                                               const TimeContext& context);
[[nodiscard]] std::vector<DueEvent> collectDueEvents(const PerformanceTimeline& timeline,
                                                     SchedulerState& state,
                                                     const TimeContext& context);
[[nodiscard]] std::vector<DueEvent> fireExternalEvents(const PerformanceTimeline& timeline,
                                                       SchedulerState& state,
                                                       const std::string& externalId,
                                                       const TimeContext& context);

} // namespace stackchan
