#include "visualizer/timeline.hpp"

#include <algorithm>
#include <cmath>
#include <utility>

namespace stackchan {
namespace {

std::string validateAnchor(const TimeAnchor& anchor) {
  const bool hasFiniteValue = std::isfinite(anchor.value);
  const bool needsValue = anchor.kind != AnchorKind::External;
  const bool hasInvalidValue = needsValue && !hasFiniteValue;
  if (hasInvalidValue) {
    return "anchor value must be finite";
  }
  const bool needsExternalId = anchor.kind == AnchorKind::External;
  const bool hasExternalId = !anchor.externalId.empty();
  const bool hasInvalidExternalId = needsExternalId && !hasExternalId;
  if (hasInvalidExternalId) {
    return "anchor external id must be non-empty";
  }
  return {};
}

std::string validateDuration(const DurationSpec& duration) {
  const bool needsValue = duration.kind != DurationKind::UntilNext;
  const bool hasFiniteValue = std::isfinite(duration.value);
  const bool hasInvalidValue = needsValue && !hasFiniteValue;
  if (hasInvalidValue) {
    return "duration value must be finite";
  }
  return {};
}

std::string validateTransition(const TransitionSpec& transition) {
  const bool isFinite =
      std::isfinite(transition.paletteMs) && std::isfinite(transition.parameterMs) &&
      std::isfinite(transition.modulationMs) && std::isfinite(transition.topologyMs);
  return isFinite ? std::string{} : "transition durations must be finite";
}

std::string validateEvent(const VisualEvent& event) {
  const bool hasId = !event.id.empty();
  if (!hasId) {
    return "event id must be non-empty";
  }
  const std::string anchorIssue = validateAnchor(event.start);
  const bool hasAnchorIssue = !anchorIssue.empty();
  if (hasAnchorIssue) {
    return anchorIssue;
  }
  const std::string durationIssue = validateDuration(event.duration);
  const bool hasDurationIssue = !durationIssue.empty();
  if (hasDurationIssue) {
    return durationIssue;
  }
  const std::string transitionIssue = validateTransition(event.transition);
  const bool hasTransitionIssue = !transitionIssue.empty();
  if (hasTransitionIssue) {
    return transitionIssue;
  }
  const bool hasValidConfidence =
      std::isfinite(event.confidence) && event.confidence >= 0.0F && event.confidence <= 1.0F;
  return hasValidConfidence ? std::string{} : "event confidence must be in 0..1";
}

std::size_t findEvent(const PerformanceTimeline& timeline, const std::string& id) {
  const auto iterator = std::find_if(timeline.events.begin(), timeline.events.end(),
                                     [&id](const VisualEvent& event) { return event.id == id; });
  const bool wasFound = iterator != timeline.events.end();
  return wasFound ? static_cast<std::size_t>(iterator - timeline.events.begin())
                  : timeline.events.size();
}

std::string protectionIssue(const VisualEvent& event, const PerformanceTimeline& timeline,
                            const TimeContext& context) {
  if (event.locked) {
    return "event is locked";
  }
  const auto resolved = resolveAnchorSeconds(event.start, context);
  const bool isProtectedTime = resolved.has_value() && *resolved < timeline.lockedUntilSec;
  return isProtectedTime ? "event fires before lockedUntilSec" : std::string{};
}

TimelineOpResult failure(const PerformanceTimeline& timeline, std::string issue) {
  return {false, timeline, std::move(issue)};
}

TimelineOpResult success(PerformanceTimeline timeline) { return {true, std::move(timeline), {}}; }

bool wasFired(const SchedulerState& state, const std::string& id) {
  return std::find(state.firedIds.begin(), state.firedIds.end(), id) != state.firedIds.end();
}

bool isDue(const VisualEvent& event, const TimeContext& context) {
  switch (event.start.kind) {
  case AnchorKind::Seconds:
    return context.nowSec >= event.start.value;
  case AnchorKind::Bar:
    return event.start.value <= context.barCount && context.bpm > 0.0F && context.tempoLocked;
  case AnchorKind::External:
    return false;
  }
  return false;
}

} // namespace

std::optional<double> resolveAnchorSeconds(const TimeAnchor& anchor, const TimeContext& context) {
  switch (anchor.kind) {
  case AnchorKind::Seconds:
    return anchor.value;
  case AnchorKind::Bar: {
    const bool canResolve = context.bpm > 0.0F && context.tempoLocked;
    if (!canResolve) {
      return std::nullopt;
    }
    const double secondsPerBar = 240.0 / context.bpm;
    return context.nowSec + (anchor.value - context.barCount - context.barPhase) * secondsPerBar;
  }
  case AnchorKind::External:
    return std::nullopt;
  }
  return std::nullopt;
}

TimelineOpResult applyTimelineOp(const PerformanceTimeline& timeline, const TimelineOp& operation,
                                 const TimeContext& context) {
  PerformanceTimeline next = timeline;
  const bool targetsExistingEvent =
      operation.kind != TimelineOpKind::Add && operation.kind != TimelineOpKind::SetLockedUntil;
  std::size_t eventIndex = timeline.events.size();
  if (targetsExistingEvent) {
    const bool hasTargetId = !operation.id.empty();
    if (!hasTargetId) {
      return failure(timeline, "operation id must be non-empty");
    }
    eventIndex = findEvent(timeline, operation.id);
    const bool targetExists = eventIndex < timeline.events.size();
    if (!targetExists) {
      return failure(timeline, "unknown event id");
    }
    const std::string issue = protectionIssue(timeline.events[eventIndex], timeline, context);
    const bool isProtected = !issue.empty();
    if (isProtected) {
      return failure(timeline, issue);
    }
  }

  switch (operation.kind) {
  case TimelineOpKind::Add: {
    const std::string issue = validateEvent(operation.event);
    const bool isInvalid = !issue.empty();
    if (isInvalid) {
      return failure(timeline, issue);
    }
    const bool isDuplicate = findEvent(timeline, operation.event.id) < timeline.events.size();
    if (isDuplicate) {
      return failure(timeline, "duplicate event id");
    }
    next.events.push_back(operation.event);
    return success(std::move(next));
  }
  case TimelineOpKind::Replace: {
    const bool idMatches = operation.event.id == operation.id;
    if (!idMatches) {
      return failure(timeline, "replacement event id must match target id");
    }
    const std::string issue = validateEvent(operation.event);
    const bool isInvalid = !issue.empty();
    if (isInvalid) {
      return failure(timeline, issue);
    }
    next.events[eventIndex] = operation.event;
    return success(std::move(next));
  }
  case TimelineOpKind::Remove:
    next.events.erase(next.events.begin() + static_cast<std::ptrdiff_t>(eventIndex));
    return success(std::move(next));
  case TimelineOpKind::SetIntent:
    next.events[eventIndex].intent = operation.intent;
    return success(std::move(next));
  case TimelineOpKind::SetTransition: {
    const std::string issue = validateTransition(operation.transition);
    const bool isInvalid = !issue.empty();
    if (isInvalid) {
      return failure(timeline, issue);
    }
    next.events[eventIndex].transition = operation.transition;
    return success(std::move(next));
  }
  case TimelineOpKind::Shift: {
    const std::string issue = validateAnchor(operation.anchor);
    const bool isInvalid = !issue.empty();
    if (isInvalid) {
      return failure(timeline, issue);
    }
    const auto resolved = resolveAnchorSeconds(operation.anchor, context);
    const bool entersProtectedTime = resolved.has_value() && *resolved < timeline.lockedUntilSec;
    if (entersProtectedTime) {
      return failure(timeline, "new anchor is before lockedUntilSec");
    }
    next.events[eventIndex].start = operation.anchor;
    return success(std::move(next));
  }
  case TimelineOpKind::SetLockedUntil: {
    const bool isFinite = std::isfinite(operation.seconds);
    if (!isFinite) {
      return failure(timeline, "lockedUntilSec must be finite");
    }
    next.lockedUntilSec = operation.seconds;
    return success(std::move(next));
  }
  }
  return failure(timeline, "unknown operation");
}

std::vector<DueEvent> collectDueEvents(const PerformanceTimeline& timeline, SchedulerState& state,
                                       const TimeContext& context) {
  struct Candidate {
    DueEvent due;
    std::size_t index = 0;
  };
  std::vector<Candidate> candidates;
  for (std::size_t index = 0; index < timeline.events.size(); ++index) {
    const VisualEvent& event = timeline.events[index];
    const bool alreadyFired = wasFired(state, event.id);
    const bool eventIsDue = isDue(event, context);
    const bool shouldFire = !alreadyFired && eventIsDue;
    if (shouldFire) {
      const auto resolved = resolveAnchorSeconds(event.start, context);
      candidates.push_back({{event, resolved.value_or(context.nowSec)}, index});
    }
  }
  std::sort(candidates.begin(), candidates.end(),
            [](const Candidate& left, const Candidate& right) {
              const bool hasDifferentTime = left.due.firedAtSec != right.due.firedAtSec;
              return hasDifferentTime ? left.due.firedAtSec < right.due.firedAtSec
                                      : left.index < right.index;
            });
  std::vector<DueEvent> due;
  due.reserve(candidates.size());
  for (const Candidate& candidate : candidates) {
    due.push_back(candidate.due);
    state.firedIds.push_back(candidate.due.event.id);
  }
  return due;
}

std::vector<DueEvent> fireExternalEvents(const PerformanceTimeline& timeline, SchedulerState& state,
                                         const std::string& externalId,
                                         const TimeContext& context) {
  std::vector<DueEvent> due;
  for (const VisualEvent& event : timeline.events) {
    const bool alreadyFired = wasFired(state, event.id);
    const bool matches =
        event.start.kind == AnchorKind::External && event.start.externalId == externalId;
    const bool shouldFire = !alreadyFired && matches;
    if (shouldFire) {
      due.push_back({event, context.nowSec});
      state.firedIds.push_back(event.id);
    }
  }
  return due;
}

} // namespace stackchan
