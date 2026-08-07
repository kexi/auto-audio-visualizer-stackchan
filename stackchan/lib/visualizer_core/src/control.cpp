#include "visualizer/control.hpp"
#include "visualizer/generated_catalog.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <iomanip>
#include <limits>
#include <optional>
#include <sstream>
#include <utility>

namespace stackchan {
namespace {

struct JsonView {
  std::size_t begin = 0;
  std::size_t end = 0;
};

void skipWhitespace(const std::string& json, std::size_t& position) {
  while (position < json.size() && std::isspace(static_cast<unsigned char>(json[position])) != 0) {
    ++position;
  }
}

std::optional<std::size_t> stringEnd(const std::string& json, std::size_t position) {
  const bool startsWithQuote = position < json.size() && json[position] == '"';
  if (!startsWithQuote) {
    return std::nullopt;
  }
  bool escaped = false;
  for (++position; position < json.size(); ++position) {
    const char character = json[position];
    if (escaped) {
      escaped = false;
      continue;
    }
    const bool startsEscape = character == '\\';
    if (startsEscape) {
      escaped = true;
      continue;
    }
    const bool endsString = character == '"';
    if (endsString) {
      return position + 1;
    }
  }
  return std::nullopt;
}

std::optional<std::size_t> valueEnd(const std::string& json, std::size_t position) {
  skipWhitespace(json, position);
  const bool reachedEnd = position >= json.size();
  if (reachedEnd) {
    return std::nullopt;
  }
  const bool isString = json[position] == '"';
  if (isString) {
    return stringEnd(json, position);
  }
  const bool isContainer = json[position] == '{' || json[position] == '[';
  if (isContainer) {
    std::string closing;
    closing.push_back(json[position] == '{' ? '}' : ']');
    bool inString = false;
    bool escaped = false;
    for (++position; position < json.size(); ++position) {
      const char character = json[position];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else {
          const bool startsEscape = character == '\\';
          const bool endsString = character == '"';
          if (startsEscape) {
            escaped = true;
          } else if (endsString) {
            inString = false;
          }
        }
        continue;
      }
      const bool startsString = character == '"';
      if (startsString) {
        inString = true;
        continue;
      }
      const bool opensContainer = character == '{' || character == '[';
      if (opensContainer) {
        closing.push_back(character == '{' ? '}' : ']');
        continue;
      }
      const bool closesContainer = character == '}' || character == ']';
      if (closesContainer) {
        const bool matches = !closing.empty() && character == closing.back();
        if (!matches) {
          return std::nullopt;
        }
        closing.pop_back();
        const bool closedRoot = closing.empty();
        if (closedRoot) {
          return position + 1;
        }
      }
    }
    return std::nullopt;
  }

  const std::size_t start = position;
  while (position < json.size() && json[position] != ',' && json[position] != '}' &&
         json[position] != ']' && std::isspace(static_cast<unsigned char>(json[position])) == 0) {
    ++position;
  }
  return position > start ? std::optional<std::size_t>{position} : std::nullopt;
}

void appendUtf8(std::string& output, std::uint32_t codePoint) {
  const bool usesOneByte = codePoint <= 0x7FU;
  if (usesOneByte) {
    output.push_back(static_cast<char>(codePoint));
    return;
  }
  const bool usesTwoBytes = codePoint <= 0x7FFU;
  if (usesTwoBytes) {
    output.push_back(static_cast<char>(0xC0U | (codePoint >> 6U)));
    output.push_back(static_cast<char>(0x80U | (codePoint & 0x3FU)));
    return;
  }
  const bool usesThreeBytes = codePoint <= 0xFFFFU;
  if (usesThreeBytes) {
    output.push_back(static_cast<char>(0xE0U | (codePoint >> 12U)));
    output.push_back(static_cast<char>(0x80U | ((codePoint >> 6U) & 0x3FU)));
    output.push_back(static_cast<char>(0x80U | (codePoint & 0x3FU)));
    return;
  }
  output.push_back(static_cast<char>(0xF0U | (codePoint >> 18U)));
  output.push_back(static_cast<char>(0x80U | ((codePoint >> 12U) & 0x3FU)));
  output.push_back(static_cast<char>(0x80U | ((codePoint >> 6U) & 0x3FU)));
  output.push_back(static_cast<char>(0x80U | (codePoint & 0x3FU)));
}

std::optional<std::uint32_t> hexCodeUnit(const std::string& json, std::size_t position) {
  const bool hasFourCharacters = position + 4 <= json.size();
  if (!hasFourCharacters) {
    return std::nullopt;
  }
  std::uint32_t output = 0;
  for (std::size_t offset = 0; offset < 4; ++offset) {
    const char character = json[position + offset];
    int digit = -1;
    const bool isDecimalDigit = character >= '0' && character <= '9';
    const bool isLowerHexDigit = character >= 'a' && character <= 'f';
    const bool isUpperHexDigit = character >= 'A' && character <= 'F';
    if (isDecimalDigit) {
      digit = character - '0';
    } else if (isLowerHexDigit) {
      digit = character - 'a' + 10;
    } else if (isUpperHexDigit) {
      digit = character - 'A' + 10;
    }
    const bool hasDigit = digit >= 0;
    if (!hasDigit) {
      return std::nullopt;
    }
    output = output * 16U + static_cast<std::uint32_t>(digit);
  }
  return output;
}

std::optional<std::string> decodeString(const std::string& json, JsonView view) {
  const bool isQuoted =
      view.end > view.begin + 1 && json[view.begin] == '"' && json[view.end - 1] == '"';
  if (!isQuoted) {
    return std::nullopt;
  }
  std::string output;
  for (std::size_t position = view.begin + 1; position + 1 < view.end; ++position) {
    const char character = json[position];
    const bool isEscape = character == '\\';
    if (!isEscape) {
      const bool isControl = static_cast<unsigned char>(character) < 0x20U;
      if (isControl) {
        return std::nullopt;
      }
      output.push_back(character);
      continue;
    }
    ++position;
    const bool hasEscapeCharacter = position + 1 < view.end;
    if (!hasEscapeCharacter) {
      return std::nullopt;
    }
    const char escape = json[position];
    switch (escape) {
    case '"':
    case '\\':
    case '/':
      output.push_back(escape);
      break;
    case 'b':
      output.push_back('\b');
      break;
    case 'f':
      output.push_back('\f');
      break;
    case 'n':
      output.push_back('\n');
      break;
    case 'r':
      output.push_back('\r');
      break;
    case 't':
      output.push_back('\t');
      break;
    case 'u': {
      const auto first = hexCodeUnit(json, position + 1);
      const bool hasFirstCodeUnit = first.has_value();
      if (!hasFirstCodeUnit) {
        return std::nullopt;
      }
      position += 4;
      std::uint32_t codePoint = *first;
      const bool isHighSurrogate = codePoint >= 0xD800U && codePoint <= 0xDBFFU;
      if (isHighSurrogate) {
        const bool hasLowEscape =
            position + 6 < view.end && json[position + 1] == '\\' && json[position + 2] == 'u';
        std::optional<std::uint32_t> low;
        if (hasLowEscape) {
          low = hexCodeUnit(json, position + 3);
        }
        const bool hasLowCodeUnit = low.has_value();
        const bool isLowSurrogate = hasLowCodeUnit && *low >= 0xDC00U && *low <= 0xDFFFU;
        if (!isLowSurrogate) {
          return std::nullopt;
        }
        codePoint = 0x10000U + ((codePoint - 0xD800U) << 10U) + (*low - 0xDC00U);
        position += 6;
      } else {
        const bool isUnexpectedLowSurrogate = codePoint >= 0xDC00U && codePoint <= 0xDFFFU;
        if (isUnexpectedLowSurrogate) {
          return std::nullopt;
        }
      }
      appendUtf8(output, codePoint);
      break;
    }
    default:
      return std::nullopt;
    }
  }
  return output;
}

std::optional<JsonView> rootObject(const std::string& json) {
  std::size_t begin = 0;
  skipWhitespace(json, begin);
  const bool startsObject = begin < json.size() && json[begin] == '{';
  if (!startsObject) {
    return std::nullopt;
  }
  const auto end = valueEnd(json, begin);
  const bool hasEnd = end.has_value();
  if (!hasEnd) {
    return std::nullopt;
  }
  std::size_t trailing = *end;
  skipWhitespace(json, trailing);
  return trailing == json.size() ? std::optional<JsonView>{{begin, *end}} : std::nullopt;
}

std::optional<JsonView> objectProperty(const std::string& json, JsonView object,
                                       const std::string& key) {
  const bool isObject =
      object.end > object.begin + 1 && json[object.begin] == '{' && json[object.end - 1] == '}';
  if (!isObject) {
    return std::nullopt;
  }
  std::size_t position = object.begin + 1;
  while (position < object.end - 1) {
    skipWhitespace(json, position);
    const bool reachedObjectEnd = position >= object.end - 1;
    if (reachedObjectEnd) {
      break;
    }
    const auto keyEnd = stringEnd(json, position);
    const bool hasKeyEnd = keyEnd.has_value();
    const bool keyFitsObject = hasKeyEnd && *keyEnd <= object.end;
    if (!keyFitsObject) {
      return std::nullopt;
    }
    const auto decodedKey = decodeString(json, {position, *keyEnd});
    const bool hasDecodedKey = decodedKey.has_value();
    if (!hasDecodedKey) {
      return std::nullopt;
    }
    position = *keyEnd;
    skipWhitespace(json, position);
    const bool hasColon = position < object.end - 1 && json[position] == ':';
    if (!hasColon) {
      return std::nullopt;
    }
    ++position;
    skipWhitespace(json, position);
    const std::size_t valueBegin = position;
    const auto end = valueEnd(json, position);
    const bool hasValueEnd = end.has_value();
    const bool valueFitsObject = hasValueEnd && *end <= object.end;
    if (!valueFitsObject) {
      return std::nullopt;
    }
    const bool matchesKey = *decodedKey == key;
    if (matchesKey) {
      return JsonView{valueBegin, *end};
    }
    position = *end;
    skipWhitespace(json, position);
    const bool hasMore = position < object.end - 1;
    if (hasMore) {
      const bool hasComma = json[position] == ',';
      if (!hasComma) {
        return std::nullopt;
      }
      ++position;
    }
  }
  return std::nullopt;
}

std::optional<std::vector<std::pair<std::string, JsonView>>> objectMembers(const std::string& json,
                                                                           JsonView object) {
  const bool isObject =
      object.end > object.begin + 1 && json[object.begin] == '{' && json[object.end - 1] == '}';
  if (!isObject) {
    return std::nullopt;
  }
  std::vector<std::pair<std::string, JsonView>> members;
  std::size_t position = object.begin + 1;
  while (position < object.end - 1) {
    skipWhitespace(json, position);
    const bool reachedObjectEnd = position >= object.end - 1;
    if (reachedObjectEnd) {
      break;
    }
    const auto keyEnd = stringEnd(json, position);
    const bool keyFitsObject = keyEnd.has_value() && *keyEnd <= object.end;
    if (!keyFitsObject) {
      return std::nullopt;
    }
    const auto key = decodeString(json, {position, *keyEnd});
    const bool hasKey = key.has_value();
    if (!hasKey) {
      return std::nullopt;
    }
    position = *keyEnd;
    skipWhitespace(json, position);
    const bool hasColon = position < object.end - 1 && json[position] == ':';
    if (!hasColon) {
      return std::nullopt;
    }
    ++position;
    skipWhitespace(json, position);
    const std::size_t valueBegin = position;
    const auto valueEndPosition = valueEnd(json, position);
    const bool valueFitsObject = valueEndPosition.has_value() && *valueEndPosition <= object.end;
    if (!valueFitsObject) {
      return std::nullopt;
    }
    members.push_back({*key, {valueBegin, *valueEndPosition}});
    position = *valueEndPosition;
    skipWhitespace(json, position);
    const bool hasMore = position < object.end - 1;
    if (hasMore) {
      const bool hasComma = json[position] == ',';
      if (!hasComma) {
        return std::nullopt;
      }
      ++position;
    }
  }
  return members;
}

std::optional<std::vector<JsonView>> arrayElements(const std::string& json, JsonView array) {
  const bool isArray =
      array.end > array.begin + 1 && json[array.begin] == '[' && json[array.end - 1] == ']';
  if (!isArray) {
    return std::nullopt;
  }
  std::vector<JsonView> elements;
  std::size_t position = array.begin + 1;
  while (position < array.end - 1) {
    skipWhitespace(json, position);
    const bool reachedArrayEnd = position >= array.end - 1;
    if (reachedArrayEnd) {
      break;
    }
    const std::size_t begin = position;
    const auto end = valueEnd(json, position);
    const bool hasEnd = end.has_value();
    const bool valueFitsArray = hasEnd && *end <= array.end;
    if (!valueFitsArray) {
      return std::nullopt;
    }
    elements.push_back({begin, *end});
    position = *end;
    skipWhitespace(json, position);
    const bool hasMore = position < array.end - 1;
    if (hasMore) {
      const bool hasComma = json[position] == ',';
      if (!hasComma) {
        return std::nullopt;
      }
      ++position;
    }
  }
  return elements;
}

std::optional<std::string> stringProperty(const std::string& json, JsonView object,
                                          const std::string& key) {
  const auto view = objectProperty(json, object, key);
  return view.has_value() ? decodeString(json, *view) : std::nullopt;
}

std::optional<double> numberValue(const std::string& json, JsonView view) {
  const std::string text = json.substr(view.begin, view.end - view.begin);
  char* end = nullptr;
  const double value = std::strtod(text.c_str(), &end);
  const bool consumedAll = end != text.c_str() && *end == '\0';
  return consumedAll && std::isfinite(value) ? std::optional<double>{value} : std::nullopt;
}

std::optional<double> numberProperty(const std::string& json, JsonView object,
                                     const std::string& key) {
  const auto view = objectProperty(json, object, key);
  return view.has_value() ? numberValue(json, *view) : std::nullopt;
}

std::optional<bool> boolProperty(const std::string& json, JsonView object, const std::string& key) {
  const auto view = objectProperty(json, object, key);
  const bool hasView = view.has_value();
  if (!hasView) {
    return std::nullopt;
  }
  const std::string text = json.substr(view->begin, view->end - view->begin);
  const bool isTrue = text == "true";
  if (isTrue) {
    return true;
  }
  const bool isFalse = text == "false";
  if (isFalse) {
    return false;
  }
  return std::nullopt;
}

std::string escapeJson(const std::string& value) {
  std::string output;
  output.reserve(value.size());
  for (const unsigned char character : value) {
    switch (character) {
    case '\\':
      output += "\\\\";
      break;
    case '"':
      output += "\\\"";
      break;
    case '\b':
      output += "\\b";
      break;
    case '\f':
      output += "\\f";
      break;
    case '\n':
      output += "\\n";
      break;
    case '\r':
      output += "\\r";
      break;
    case '\t':
      output += "\\t";
      break;
    default:
      const bool isControlCharacter = character < 0x20U;
      if (isControlCharacter) {
        std::ostringstream escaped;
        escaped << "\\u" << std::hex << std::setw(4) << std::setfill('0')
                << static_cast<int>(character);
        output += escaped.str();
      } else {
        output.push_back(static_cast<char>(character));
      }
      break;
    }
  }
  return output;
}

ControlMethod methodFromName(const std::string& name) {
  constexpr std::array<std::pair<const char*, ControlMethod>, 16> kMethods = {{
      {"getState", ControlMethod::GetState},
      {"getCatalog", ControlMethod::GetCatalog},
      {"setImage", ControlMethod::SetImage},
      {"proposePatch", ControlMethod::ProposePatch},
      {"proposeSeed", ControlMethod::ProposeSeed},
      {"setScene", ControlMethod::SetScene},
      {"shiftScene", ControlMethod::ShiftScene},
      {"reroll", ControlMethod::Reroll},
      {"tapTempo", ControlMethod::TapTempo},
      {"tempoMultiply", ControlMethod::TempoMultiply},
      {"tempoAuto", ControlMethod::TempoAuto},
      {"applyTimelineOp", ControlMethod::ApplyTimelineOp},
      {"fireExternal", ControlMethod::FireExternal},
      {"startRecording", ControlMethod::StartRecording},
      {"stopRecording", ControlMethod::StopRecording},
      {"loadRecording", ControlMethod::LoadRecording},
  }};
  for (const auto& candidate : kMethods) {
    const bool matches = name == candidate.first;
    if (matches) {
      return candidate.second;
    }
  }
  return ControlMethod::Unknown;
}

std::optional<TimeAnchor> parseAnchor(const std::string& json, JsonView object) {
  const auto kind = stringProperty(json, object, "kind");
  const bool hasKind = kind.has_value();
  if (!hasKind) {
    return std::nullopt;
  }
  TimeAnchor anchor{};
  const bool usesSeconds = *kind == "seconds";
  if (usesSeconds) {
    const auto value = numberProperty(json, object, "atSec");
    const bool hasValue = value.has_value();
    if (!hasValue) {
      return std::nullopt;
    }
    anchor.kind = AnchorKind::Seconds;
    anchor.value = *value;
    return anchor;
  }
  const bool usesBar = *kind == "bar";
  if (usesBar) {
    const auto value = numberProperty(json, object, "bar");
    const bool hasValue = value.has_value();
    if (!hasValue) {
      return std::nullopt;
    }
    anchor.kind = AnchorKind::Bar;
    anchor.value = *value;
    return anchor;
  }
  const bool usesExternal = *kind == "external";
  if (usesExternal) {
    const auto id = stringProperty(json, object, "id");
    const bool hasId = id.has_value() && !id->empty();
    if (!hasId) {
      return std::nullopt;
    }
    anchor.kind = AnchorKind::External;
    anchor.externalId = *id;
    return anchor;
  }
  return std::nullopt;
}

std::optional<DurationSpec> parseDuration(const std::string& json, JsonView object) {
  const auto kind = stringProperty(json, object, "kind");
  const bool hasKind = kind.has_value();
  if (!hasKind) {
    return std::nullopt;
  }
  DurationSpec duration{};
  const bool usesUntilNext = *kind == "untilNext";
  if (usesUntilNext) {
    duration.kind = DurationKind::UntilNext;
    return duration;
  }
  const std::string key = *kind == "seconds" ? "sec" : "bars";
  const auto value = numberProperty(json, object, key);
  const bool hasValue = value.has_value();
  if (!hasValue) {
    return std::nullopt;
  }
  const bool usesSeconds = *kind == "seconds";
  const bool usesBars = *kind == "bars";
  if (usesSeconds) {
    duration.kind = DurationKind::Seconds;
  } else if (usesBars) {
    duration.kind = DurationKind::Bars;
  } else {
    return std::nullopt;
  }
  duration.value = *value;
  return duration;
}

std::optional<TransitionSpec> parseTransition(const std::string& json, JsonView object) {
  const auto palette = numberProperty(json, object, "paletteMs");
  const auto parameter = numberProperty(json, object, "parameterMs");
  const auto modulation = numberProperty(json, object, "modulationMs");
  const auto topology = numberProperty(json, object, "topologyMs");
  const auto easing = stringProperty(json, object, "easing");
  const bool hasFields = palette.has_value() && parameter.has_value() && modulation.has_value() &&
                         topology.has_value() && easing.has_value();
  const bool hasKnownEasing = hasFields && (*easing == "linear" || *easing == "easeInOut");
  if (!hasKnownEasing) {
    return std::nullopt;
  }
  return TransitionSpec{*palette, *parameter, *modulation, *topology,
                        *easing == "linear" ? TransitionEasing::Linear
                                            : TransitionEasing::EaseInOut};
}

std::optional<std::string> visualPatchIssue(const std::string& json, JsonView patch);

bool hasVisualPatchShape(const std::string& json, JsonView patch) {
  return !visualPatchIssue(json, patch).has_value();
}

std::optional<SemanticIntent> parseIntent(const std::string& json, JsonView object) {
  const bool isObject = object.end > object.begin && json[object.begin] == '{';
  if (!isObject) {
    return std::nullopt;
  }
  SemanticIntent intent{};
  const auto labelView = objectProperty(json, object, "label");
  const bool hasLabelView = labelView.has_value();
  if (hasLabelView) {
    const auto label = decodeString(json, *labelView);
    const bool hasLabel = label.has_value();
    if (!hasLabel) {
      return std::nullopt;
    }
    intent.label = *label;
  }
  const auto seedView = objectProperty(json, object, "seed");
  const bool hasSeedView = seedView.has_value();
  if (hasSeedView) {
    const auto seed = decodeString(json, *seedView);
    const bool hasSeed = seed.has_value();
    if (!hasSeed) {
      return std::nullopt;
    }
    intent.seed = *seed;
  }
  const auto patch = objectProperty(json, object, "patch");
  const bool hasPatch = patch.has_value();
  if (hasPatch) {
    const bool hasPatchShape = hasVisualPatchShape(json, *patch);
    if (!hasPatchShape) {
      return std::nullopt;
    }
    intent.patchJson = json.substr(patch->begin, patch->end - patch->begin);
  }
  return intent;
}

std::optional<VisualEvent> parseEvent(const std::string& json, JsonView object) {
  const auto id = stringProperty(json, object, "id");
  const auto startView = objectProperty(json, object, "start");
  const auto durationView = objectProperty(json, object, "duration");
  const auto intentView = objectProperty(json, object, "intent");
  const auto transitionView = objectProperty(json, object, "transition");
  const auto confidence = numberProperty(json, object, "confidence");
  const auto locked = boolProperty(json, object, "locked");
  const bool hasFields = id.has_value() && startView.has_value() && durationView.has_value() &&
                         intentView.has_value() && transitionView.has_value() &&
                         confidence.has_value() && locked.has_value();
  if (!hasFields) {
    return std::nullopt;
  }
  const auto start = parseAnchor(json, *startView);
  const auto duration = parseDuration(json, *durationView);
  const auto intent = parseIntent(json, *intentView);
  const auto transition = parseTransition(json, *transitionView);
  const bool parsedFields =
      start.has_value() && duration.has_value() && intent.has_value() && transition.has_value();
  if (!parsedFields) {
    return std::nullopt;
  }
  return VisualEvent{
      *id, *start, *duration, *intent, *transition, static_cast<float>(*confidence), *locked};
}

std::optional<TimelineOp> parseTimelineOperation(const std::string& json, JsonView object) {
  const auto operationName = stringProperty(json, object, "op");
  const bool hasOperationName = operationName.has_value();
  if (!hasOperationName) {
    return std::nullopt;
  }
  TimelineOp operation{};
  const bool addsEvent = *operationName == "add";
  const bool replacesEvent = *operationName == "replace";
  if (addsEvent || replacesEvent) {
    const auto eventView = objectProperty(json, object, "event");
    const auto event = eventView.has_value() ? parseEvent(json, *eventView) : std::nullopt;
    const bool hasEvent = event.has_value();
    if (!hasEvent) {
      return std::nullopt;
    }
    operation.kind = *operationName == "add" ? TimelineOpKind::Add : TimelineOpKind::Replace;
    operation.event = *event;
    if (replacesEvent) {
      const auto id = stringProperty(json, object, "id");
      const bool hasId = id.has_value();
      if (!hasId) {
        return std::nullopt;
      }
      operation.id = *id;
    }
    return operation;
  }
  const bool removesEvent = *operationName == "remove";
  if (removesEvent) {
    const auto id = stringProperty(json, object, "id");
    const bool hasId = id.has_value();
    if (!hasId) {
      return std::nullopt;
    }
    operation.kind = TimelineOpKind::Remove;
    operation.id = *id;
    return operation;
  }
  const bool setsIntent = *operationName == "setIntent";
  if (setsIntent) {
    const auto id = stringProperty(json, object, "id");
    const auto intentView = objectProperty(json, object, "intent");
    const auto intent = intentView.has_value() ? parseIntent(json, *intentView) : std::nullopt;
    const bool hasFields = id.has_value() && intent.has_value();
    if (!hasFields) {
      return std::nullopt;
    }
    operation.kind = TimelineOpKind::SetIntent;
    operation.id = *id;
    operation.intent = *intent;
    return operation;
  }
  const bool setsTransition = *operationName == "setTransition";
  if (setsTransition) {
    const auto id = stringProperty(json, object, "id");
    const auto transitionView = objectProperty(json, object, "transition");
    const auto transition =
        transitionView.has_value() ? parseTransition(json, *transitionView) : std::nullopt;
    const bool hasFields = id.has_value() && transition.has_value();
    if (!hasFields) {
      return std::nullopt;
    }
    operation.kind = TimelineOpKind::SetTransition;
    operation.id = *id;
    operation.transition = *transition;
    return operation;
  }
  const bool shiftsEvent = *operationName == "shift";
  if (shiftsEvent) {
    const auto id = stringProperty(json, object, "id");
    const auto anchorView = objectProperty(json, object, "anchor");
    const auto anchor = anchorView.has_value() ? parseAnchor(json, *anchorView) : std::nullopt;
    const bool hasFields = id.has_value() && anchor.has_value();
    if (!hasFields) {
      return std::nullopt;
    }
    operation.kind = TimelineOpKind::Shift;
    operation.id = *id;
    operation.anchor = *anchor;
    return operation;
  }
  const bool setsLockedUntil = *operationName == "setLockedUntil";
  if (setsLockedUntil) {
    const auto seconds = numberProperty(json, object, "sec");
    const bool hasSeconds = seconds.has_value();
    if (!hasSeconds) {
      return std::nullopt;
    }
    operation.kind = TimelineOpKind::SetLockedUntil;
    operation.seconds = *seconds;
    return operation;
  }
  return std::nullopt;
}

std::string encodeAnchor(const TimeAnchor& anchor) {
  std::ostringstream output;
  switch (anchor.kind) {
  case AnchorKind::Seconds:
    output << "{\"kind\":\"seconds\",\"atSec\":" << anchor.value << '}';
    break;
  case AnchorKind::Bar:
    output << "{\"kind\":\"bar\",\"bar\":" << anchor.value << '}';
    break;
  case AnchorKind::External:
    output << "{\"kind\":\"external\",\"id\":\"" << escapeJson(anchor.externalId) << "\"}";
    break;
  }
  return output.str();
}

std::string encodeDuration(const DurationSpec& duration) {
  std::ostringstream output;
  switch (duration.kind) {
  case DurationKind::Seconds:
    output << "{\"kind\":\"seconds\",\"sec\":" << duration.value << '}';
    break;
  case DurationKind::Bars:
    output << "{\"kind\":\"bars\",\"bars\":" << duration.value << '}';
    break;
  case DurationKind::UntilNext:
    output << "{\"kind\":\"untilNext\"}";
    break;
  }
  return output.str();
}

std::string encodeIntent(const SemanticIntent& intent) {
  std::ostringstream output;
  output << '{';
  bool needsComma = false;
  const bool hasLabel = !intent.label.empty();
  if (hasLabel) {
    output << "\"label\":\"" << escapeJson(intent.label) << '"';
    needsComma = true;
  }
  const bool hasSeed = !intent.seed.empty();
  if (hasSeed) {
    output << (needsComma ? "," : "") << "\"seed\":\"" << escapeJson(intent.seed) << '"';
    needsComma = true;
  }
  const bool hasPatch = !intent.patchJson.empty();
  if (hasPatch) {
    output << (needsComma ? "," : "") << "\"patch\":" << intent.patchJson;
  }
  output << '}';
  return output.str();
}

std::string encodeTransition(const TransitionSpec& transition) {
  std::ostringstream output;
  output << "{\"paletteMs\":" << transition.paletteMs
         << ",\"parameterMs\":" << transition.parameterMs
         << ",\"modulationMs\":" << transition.modulationMs
         << ",\"topologyMs\":" << transition.topologyMs << ",\"easing\":\""
         << (transition.easing == TransitionEasing::Linear ? "linear" : "easeInOut") << "\"}";
  return output.str();
}

std::string encodeEvent(const VisualEvent& event) {
  std::ostringstream output;
  output << "{\"id\":\"" << escapeJson(event.id) << "\",\"start\":" << encodeAnchor(event.start)
         << ",\"duration\":" << encodeDuration(event.duration)
         << ",\"intent\":" << encodeIntent(event.intent)
         << ",\"transition\":" << encodeTransition(event.transition)
         << ",\"confidence\":" << event.confidence
         << ",\"locked\":" << (event.locked ? "true" : "false") << '}';
  return output.str();
}

std::string encodeTimeline(const PerformanceTimeline& timeline) {
  std::ostringstream output;
  output << "{\"lockedUntilSec\":" << timeline.lockedUntilSec << ",\"events\":[";
  for (std::size_t index = 0; index < timeline.events.size(); ++index) {
    output << (index > 0 ? "," : "") << encodeEvent(timeline.events[index]);
  }
  output << "]}";
  return output.str();
}

std::string encodeTimelineOperation(const TimelineOp& operation) {
  std::ostringstream output;
  switch (operation.kind) {
  case TimelineOpKind::Add:
    output << "{\"op\":\"add\",\"event\":" << encodeEvent(operation.event) << '}';
    break;
  case TimelineOpKind::Replace:
    output << "{\"op\":\"replace\",\"id\":\"" << escapeJson(operation.id)
           << "\",\"event\":" << encodeEvent(operation.event) << '}';
    break;
  case TimelineOpKind::Remove:
    output << "{\"op\":\"remove\",\"id\":\"" << escapeJson(operation.id) << "\"}";
    break;
  case TimelineOpKind::SetIntent:
    output << "{\"op\":\"setIntent\",\"id\":\"" << escapeJson(operation.id)
           << "\",\"intent\":" << encodeIntent(operation.intent) << '}';
    break;
  case TimelineOpKind::SetTransition:
    output << "{\"op\":\"setTransition\",\"id\":\"" << escapeJson(operation.id)
           << "\",\"transition\":" << encodeTransition(operation.transition) << '}';
    break;
  case TimelineOpKind::Shift:
    output << "{\"op\":\"shift\",\"id\":\"" << escapeJson(operation.id)
           << "\",\"anchor\":" << encodeAnchor(operation.anchor) << '}';
    break;
  case TimelineOpKind::SetLockedUntil:
    output << "{\"op\":\"setLockedUntil\",\"sec\":" << operation.seconds << '}';
    break;
  }
  return output.str();
}

const char* paletteModeName(PaletteMode mode) {
  switch (mode) {
  case PaletteMode::Mono:
    return "mono";
  case PaletteMode::Analogous:
    return "analogous";
  case PaletteMode::Complementary:
    return "complementary";
  case PaletteMode::Triadic:
    return "triadic";
  case PaletteMode::Rainbow:
    return "rainbow";
  }
  return "mono";
}

std::string fallbackPatchJson(const Settings& settings, const Variation& variation) {
  std::ostringstream output;
  output << "{\"schemaVersion\":1,\"seed\":\"" << escapeJson(settings.seed) << "\",\"operators\":["
         << "{\"id\":\"src0\",\"generatorId\":\"grid\",\"generatorVersion\":1,"
            "\"parameters\":{\"cells\":8,\"thickness\":0.08}},"
         << "{\"id\":\"mod0\",\"generatorId\":\"spin\",\"generatorVersion\":1,"
            "\"parameters\":{\"rate\":0.4,\"wobble\":0.2}},"
         << "{\"id\":\"mat0\",\"generatorId\":\"neon\",\"generatorVersion\":1,"
            "\"parameters\":{\"hue\":"
         << variation.hueOffset << ",\"intensity\":1.2}}],\"routes\":[],\"palette\":{"
         << "\"mode\":\"" << paletteModeName(variation.paletteMode)
         << "\",\"hueOffset\":" << variation.hueOffset << ",\"saturation\":" << variation.saturation
         << ",\"lightness\":" << variation.lightness << "},\"composition\":{"
         << "\"symmetry\":" << variation.symmetry << ",\"scale\":" << variation.scale
         << ",\"speed\":" << variation.speed << "},\"qualityTier\":\"medium\"}";
  return output.str();
}

struct ReplayOperation {
  double atSec = 0.0;
  TimelineOp operation{};
  std::size_t sourceIndex = 0;
};

struct ParsedRecording {
  bool ok = false;
  std::string issue;
  std::string sessionSeed;
  std::string initialPatchJson;
  SemanticIntent initialIntent{};
  std::vector<ReplayOperation> operations;
};

bool isJsonObject(const std::string& json, JsonView view) {
  return view.end > view.begin + 1 && json[view.begin] == '{' && json[view.end - 1] == '}';
}

bool isJsonArray(const std::string& json, JsonView view) {
  return view.end > view.begin + 1 && json[view.begin] == '[' && json[view.end - 1] == ']';
}

std::optional<bool> booleanValue(const std::string& json, JsonView view) {
  const std::string text = json.substr(view.begin, view.end - view.begin);
  const bool isTrue = text == "true";
  if (isTrue) {
    return true;
  }
  const bool isFalse = text == "false";
  return isFalse ? std::optional<bool>{false} : std::nullopt;
}

const GeneratedGeneratorDefinition* generatorDefinition(const std::string& id) {
  for (std::size_t index = 0; index < kGeneratorDefinitionCount; ++index) {
    const bool matches = id == kGeneratorDefinitions[index].id;
    if (matches) {
      return &kGeneratorDefinitions[index];
    }
  }
  return nullptr;
}

const GeneratedParameterDefinition* parameterDefinition(const std::string& generatorId,
                                                        const std::string& parameterId) {
  for (std::size_t index = 0; index < kParameterDefinitionCount; ++index) {
    const auto& definition = kParameterDefinitions[index];
    const bool matches = generatorId == definition.generatorId && parameterId == definition.id;
    if (matches) {
      return &definition;
    }
  }
  return nullptr;
}

bool hasTextureDefinition(const std::string& generatorId, const std::string& textureId) {
  for (std::size_t index = 0; index < kTextureDefinitionCount; ++index) {
    const auto& definition = kTextureDefinitions[index];
    const bool matches = generatorId == definition.generatorId && textureId == definition.id;
    if (matches) {
      return true;
    }
  }
  return false;
}

bool enumContains(const char* options, const std::string& value) {
  const std::string values = options;
  std::size_t begin = 0;
  while (begin <= values.size()) {
    const std::size_t separator = values.find('|', begin);
    const std::size_t end = separator == std::string::npos ? values.size() : separator;
    const bool matches = values.substr(begin, end - begin) == value;
    if (matches) {
      return true;
    }
    const bool reachedEnd = separator == std::string::npos;
    if (reachedEnd) {
      break;
    }
    begin = separator + 1;
  }
  return false;
}

std::optional<std::pair<std::string, std::string>> patchTarget(const std::string& value) {
  const std::size_t separator = value.find('.');
  const bool hasTwoParts = separator > 0 && separator < value.size() - 1;
  const bool hasOneSeparator = hasTwoParts && value.find('.', separator + 1) == std::string::npos;
  if (!hasOneSeparator) {
    return std::nullopt;
  }
  return std::pair<std::string, std::string>{value.substr(0, separator),
                                             value.substr(separator + 1)};
}

int categoryRank(const std::string& category) {
  const bool isSource = category == "source";
  const bool isField = category == "field";
  const bool isModifier = category == "modifier";
  if (isSource) {
    return 0;
  }
  if (isField) {
    return 1;
  }
  return isModifier ? 2 : 3;
}

double costWeight(const std::string& costClass) {
  const bool isMicro = costClass == "micro";
  const bool isLight = costClass == "light";
  const bool isMedium = costClass == "medium";
  if (isMicro) {
    return 1.0;
  }
  if (isLight) {
    return 3.0;
  }
  return isMedium ? 10.0 : 30.0;
}

std::optional<std::string> parameterValueIssue(const std::string& json, JsonView value,
                                               const GeneratedParameterDefinition& definition) {
  const std::string kind = definition.kind;
  const bool expectsNumber = kind == "number" || kind == "int";
  if (expectsNumber) {
    const auto number = numberValue(json, value);
    const bool hasNumber = number.has_value();
    const bool expectsInteger = kind == "int";
    const bool isInteger = hasNumber && std::floor(*number) == *number;
    const bool hasExpectedType = hasNumber && (!expectsInteger || isInteger);
    if (!hasExpectedType) {
      return "parameter \"" + std::string(definition.id) + "\" has invalid type";
    }
    const bool belowMinimum = definition.hasRange && *number < definition.minimum;
    const bool aboveMaximum = definition.hasRange && *number > definition.maximum;
    if (belowMinimum || aboveMaximum) {
      return "parameter \"" + std::string(definition.id) + "\" is outside its range";
    }
    return std::nullopt;
  }
  const bool expectsBoolean = kind == "bool";
  if (expectsBoolean) {
    const bool hasBoolean = booleanValue(json, value).has_value();
    return hasBoolean ? std::nullopt
                      : std::optional<std::string>{"parameter \"" + std::string(definition.id) +
                                                   "\" must be boolean"};
  }
  const auto enumValue = decodeString(json, value);
  const bool hasEnumValue = enumValue.has_value() && enumContains(definition.options, *enumValue);
  return hasEnumValue ? std::nullopt
                      : std::optional<std::string>{"parameter \"" + std::string(definition.id) +
                                                   "\" is not a supported enum value"};
}

struct ValidatedOperator {
  std::string id;
  const GeneratedGeneratorDefinition* generator = nullptr;
};

const ValidatedOperator* validatedOperator(const std::vector<ValidatedOperator>& operators,
                                           const std::string& id) {
  for (const auto& operation : operators) {
    const bool matches = operation.id == id;
    if (matches) {
      return &operation;
    }
  }
  return nullptr;
}

std::optional<std::string> visualPatchIssue(const std::string& json, JsonView patch) {
  const bool isPatchObject = isJsonObject(json, patch);
  if (!isPatchObject) {
    return "patch must be an object";
  }
  const auto schemaVersion = numberProperty(json, patch, "schemaVersion");
  const auto seed = stringProperty(json, patch, "seed");
  const auto operators = objectProperty(json, patch, "operators");
  const auto routes = objectProperty(json, patch, "routes");
  const auto palette = objectProperty(json, patch, "palette");
  const auto composition = objectProperty(json, patch, "composition");
  const auto quality = stringProperty(json, patch, "qualityTier");
  const bool hasSchemaVersion =
      schemaVersion.has_value() && *schemaVersion == 1.0 && std::floor(*schemaVersion) == 1.0;
  if (!hasSchemaVersion) {
    return "schemaVersion must be 1";
  }
  const bool hasSeed = seed.has_value();
  if (!hasSeed) {
    return "seed must be a string";
  }
  const bool hasArrays = operators.has_value() && routes.has_value() &&
                         isJsonArray(json, *operators) && isJsonArray(json, *routes);
  if (!hasArrays) {
    return "operators and routes must be arrays";
  }
  const bool hasObjects = palette.has_value() && composition.has_value() &&
                          isJsonObject(json, *palette) && isJsonObject(json, *composition);
  if (!hasObjects) {
    return "palette and composition must be objects";
  }
  const bool hasQuality =
      quality.has_value() && (*quality == "low" || *quality == "medium" || *quality == "high");
  if (!hasQuality) {
    return "qualityTier must be low, medium, or high";
  }

  const auto operatorElements = arrayElements(json, *operators);
  const auto routeElements = arrayElements(json, *routes);
  const bool hasElements = operatorElements.has_value() && routeElements.has_value();
  if (!hasElements) {
    return "operators or routes contains malformed JSON";
  }

  std::vector<ValidatedOperator> validatedOperators;
  std::array<int, 4> categoryCounts{};
  int lastCategoryRank = -1;
  double totalCost = 0.0;
  int totalPasses = 0;
  int heavyCount = 0;
  int statefulCount = 0;
  const double resolutionScale = *quality == "low" ? 0.5 : (*quality == "medium" ? 0.75 : 1.0);
  for (const JsonView operation : *operatorElements) {
    const bool isOperatorObject = isJsonObject(json, operation);
    if (!isOperatorObject) {
      return "every operator must be an object";
    }
    const auto id = stringProperty(json, operation, "id");
    const auto generatorId = stringProperty(json, operation, "generatorId");
    const auto generatorVersion = numberProperty(json, operation, "generatorVersion");
    const auto parameters = objectProperty(json, operation, "parameters");
    const bool hasOperatorFields =
        id.has_value() && generatorId.has_value() && generatorVersion.has_value() &&
        std::floor(*generatorVersion) == *generatorVersion && *generatorVersion >= 1.0 &&
        parameters.has_value() && isJsonObject(json, *parameters);
    if (!hasOperatorFields) {
      return "operator fields do not match VisualOperator schema";
    }
    const bool hasDuplicateId = validatedOperator(validatedOperators, *id) != nullptr;
    if (hasDuplicateId) {
      return "duplicate operator id \"" + *id + "\"";
    }
    const auto* definition = generatorDefinition(*generatorId);
    const bool hasGenerator = definition != nullptr;
    if (!hasGenerator) {
      return "generator \"" + *generatorId + "\" not found in catalog";
    }
    const bool hasMatchingVersion = definition->version == static_cast<int>(*generatorVersion);
    if (!hasMatchingVersion) {
      return "generator \"" + *generatorId + "\" version does not match catalog";
    }
    const int rank = categoryRank(definition->category);
    const bool hasValidStageOrder = rank >= lastCategoryRank;
    if (!hasValidStageOrder) {
      return "operators must be ordered Source -> Field -> Modifier -> Material";
    }
    lastCategoryRank = rank;
    ++categoryCounts[static_cast<std::size_t>(rank)];

    const auto parameterMembers = objectMembers(json, *parameters);
    const bool hasParameterMembers = parameterMembers.has_value();
    if (!hasParameterMembers) {
      return "operator parameters contains malformed JSON";
    }
    for (const auto& parameter : *parameterMembers) {
      const auto* parameterDef = parameterDefinition(*generatorId, parameter.first);
      const bool hasParameter = parameterDef != nullptr;
      if (!hasParameter) {
        return "parameter \"" + parameter.first + "\" is not defined on generator \"" +
               *generatorId + "\"";
      }
      const auto issue = parameterValueIssue(json, parameter.second, *parameterDef);
      const bool hasIssue = issue.has_value();
      if (hasIssue) {
        return issue;
      }
    }

    totalCost += costWeight(definition->costClass) * definition->relativeFill * resolutionScale *
                 resolutionScale;
    totalPasses += definition->passes;
    heavyCount += std::string(definition->costClass) == "heavy" ? 1 : 0;
    statefulCount += definition->stateful ? 1 : 0;
    validatedOperators.push_back({*id, definition});
  }

  const bool hasValidSourceCount = categoryCounts[0] >= 1 && categoryCounts[0] <= 2;
  const bool hasValidFieldCount = categoryCounts[1] <= 2;
  const bool hasValidModifierCount = categoryCounts[2] >= 1 && categoryCounts[2] <= 3;
  const bool hasValidMaterialCount = categoryCounts[3] == 1;
  const bool hasValidCounts =
      hasValidSourceCount && hasValidFieldCount && hasValidModifierCount && hasValidMaterialCount;
  if (!hasValidCounts) {
    return "operator category counts exceed the VisualPatch limits";
  }

  for (const JsonView route : *routeElements) {
    const bool isRouteObject = isJsonObject(json, route);
    if (!isRouteObject) {
      return "every route must be an object";
    }
    const auto source = stringProperty(json, route, "source");
    const auto target = stringProperty(json, route, "target");
    const auto amount = numberProperty(json, route, "amount");
    const auto polarity = stringProperty(json, route, "polarity");
    const auto smoothing = numberProperty(json, route, "smoothing");
    const bool hasRouteFields = source.has_value() && target.has_value() && amount.has_value() &&
                                polarity.has_value() && smoothing.has_value();
    if (!hasRouteFields) {
      return "route fields do not match ModulationRoute schema";
    }
    const bool hasPolarity = *polarity == "unipolar" || *polarity == "bipolar";
    const bool hasSmoothing = *smoothing >= 0.0;
    if (!hasPolarity || !hasSmoothing) {
      return "route polarity or smoothing is invalid";
    }
    const auto targetParts = patchTarget(*target);
    const bool hasTargetParts = targetParts.has_value();
    if (!hasTargetParts) {
      return "route target must be <opId>.<paramId>";
    }
    const auto* targetOperator = validatedOperator(validatedOperators, targetParts->first);
    const bool hasTargetOperator = targetOperator != nullptr;
    if (!hasTargetOperator) {
      return "route target operator does not exist";
    }
    const auto* targetParameter =
        parameterDefinition(targetOperator->generator->id, targetParts->second);
    const bool hasTargetParameter = targetParameter != nullptr;
    if (!hasTargetParameter) {
      return "route target parameter does not exist";
    }
    const bool isModulatable = targetParameter->modulatable;
    if (!isModulatable) {
      return "route target parameter is not modulatable";
    }

    constexpr std::array<const char*, 8> kKnownSources = {
        "time",        "audio:bass", "audio:mid",      "audio:treble",
        "audio:level", "audio:beat", "audio:barPhase", "audio:beatPhase",
    };
    const bool isKnownSource =
        std::any_of(kKnownSources.begin(), kKnownSources.end(),
                    [&source](const char* candidate) { return *source == candidate; });
    const std::string operatorPrefix = "operator:";
    const bool isOperatorSource = source->rfind(operatorPrefix, 0) == 0;
    const std::string sourceOperatorId =
        isOperatorSource ? source->substr(operatorPrefix.size()) : std::string{};
    const bool hasSourceOperator =
        isOperatorSource && validatedOperator(validatedOperators, sourceOperatorId) != nullptr;
    if (!isKnownSource && !hasSourceOperator) {
      return "route source is not recognized";
    }
    const bool isSelfModulation = isOperatorSource && sourceOperatorId == targetParts->first;
    if (isSelfModulation) {
      return "an operator cannot modulate itself";
    }
  }

  const auto mode = stringProperty(json, *palette, "mode");
  const auto hueOffset = numberProperty(json, *palette, "hueOffset");
  const auto saturation = numberProperty(json, *palette, "saturation");
  const auto lightness = numberProperty(json, *palette, "lightness");
  const bool hasPaletteFields =
      mode.has_value() && hueOffset.has_value() && saturation.has_value() && lightness.has_value();
  if (!hasPaletteFields) {
    return "palette fields do not match PaletteSpec schema";
  }
  constexpr std::array<const char*, 5> kPaletteModes = {"mono", "analogous", "complementary",
                                                        "triadic", "rainbow"};
  const bool hasPaletteMode = std::any_of(kPaletteModes.begin(), kPaletteModes.end(),
                                          [&mode](const char* value) { return *mode == value; });
  const bool hasPaletteRanges = *hueOffset >= 0.0 && *hueOffset <= 360.0 && *saturation >= 0.0 &&
                                *saturation <= 100.0 && *lightness >= 0.0 && *lightness <= 100.0;
  if (!hasPaletteMode || !hasPaletteRanges) {
    return "palette mode or numeric range is invalid";
  }

  const auto symmetry = numberProperty(json, *composition, "symmetry");
  const auto scale = numberProperty(json, *composition, "scale");
  const auto speed = numberProperty(json, *composition, "speed");
  const bool hasComposition = symmetry.has_value() && scale.has_value() && speed.has_value();
  if (!hasComposition) {
    return "composition fields must be finite numbers";
  }

  const auto images = objectProperty(json, patch, "images");
  const bool hasImages = images.has_value();
  if (hasImages) {
    const auto imageMembers = objectMembers(json, *images);
    const bool hasImageMembers = imageMembers.has_value();
    if (!hasImageMembers) {
      return "images must be an object";
    }
    for (const auto& image : *imageMembers) {
      const auto targetParts = patchTarget(image.first);
      const bool hasTargetParts = targetParts.has_value();
      if (!hasTargetParts) {
        return "image key must be <opId>.<slot>";
      }
      const auto* targetOperator = validatedOperator(validatedOperators, targetParts->first);
      const bool hasTargetOperator = targetOperator != nullptr;
      if (!hasTargetOperator) {
        return "image target operator does not exist";
      }
      const bool hasTextureSlot =
          hasTextureDefinition(targetOperator->generator->id, targetParts->second);
      if (!hasTextureSlot) {
        return "image target texture slot does not exist";
      }
      const bool isImageObject = isJsonObject(json, image.second);
      if (!isImageObject) {
        return "image reference must be an object";
      }
      const auto name = stringProperty(json, image.second, "name");
      const auto hash = stringProperty(json, image.second, "hash");
      const bool hasImageReference =
          name.has_value() && !name->empty() && hash.has_value() && !hash->empty();
      if (!hasImageReference) {
        return "image reference name and hash must be non-empty strings";
      }
    }
  }

  const double maximumCost = *quality == "low" ? 50.0 : (*quality == "medium" ? 120.0 : 250.0);
  const int maximumPasses = *quality == "low" ? 2 : (*quality == "medium" ? 4 : 8);
  const int maximumHeavy = *quality == "low" ? 0 : (*quality == "medium" ? 1 : 2);
  const int maximumStateful = *quality == "low" ? 1 : (*quality == "medium" ? 2 : 3);
  const bool fitsBudget = totalCost <= maximumCost && totalPasses <= maximumPasses &&
                          heavyCount <= maximumHeavy && statefulCount <= maximumStateful;
  return fitsBudget ? std::nullopt
                    : std::optional<std::string>{"patch exceeds its quality-tier render budget"};
}

ParsedRecording parsePerformanceRecording(const std::string& json) {
  ParsedRecording parsed{};
  const auto root = rootObject(json);
  const bool hasRoot = root.has_value();
  if (!hasRoot) {
    parsed.issue = "recording must be one JSON object";
    return parsed;
  }
  const auto schemaVersion = numberProperty(json, *root, "schemaVersion");
  const auto engineVersion = stringProperty(json, *root, "engineVersion");
  const auto sessionSeed = stringProperty(json, *root, "sessionSeed");
  const auto patch = objectProperty(json, *root, "initialPatch");
  const auto operationsView = objectProperty(json, *root, "ops");
  const auto firedView = objectProperty(json, *root, "fired");
  const bool hasRecordingFields = schemaVersion.has_value() && *schemaVersion == 1.0 &&
                                  engineVersion.has_value() && sessionSeed.has_value() &&
                                  patch.has_value() && operationsView.has_value() &&
                                  firedView.has_value();
  if (!hasRecordingFields) {
    parsed.issue = "recording fields are missing or schemaVersion is not 1";
    return parsed;
  }
  const bool hasPatchShape = hasVisualPatchShape(json, *patch);
  if (!hasPatchShape) {
    parsed.issue = "initialPatch does not match VisualPatch schema";
    return parsed;
  }
  const auto patchSeed = stringProperty(json, *patch, "seed");
  parsed.sessionSeed = *sessionSeed;
  parsed.initialPatchJson = json.substr(patch->begin, patch->end - patch->begin);
  parsed.initialIntent.seed = *patchSeed;
  parsed.initialIntent.patchJson = parsed.initialPatchJson;

  const auto operationElements = arrayElements(json, *operationsView);
  const auto firedElements = arrayElements(json, *firedView);
  const bool hasArrays = operationElements.has_value() && firedElements.has_value();
  if (!hasArrays) {
    parsed.issue = "recording ops and fired must be arrays";
    return parsed;
  }
  for (std::size_t index = 0; index < operationElements->size(); ++index) {
    const JsonView entry = (*operationElements)[index];
    const auto atSec = numberProperty(json, entry, "atSec");
    const auto operationView = objectProperty(json, entry, "op");
    const auto operation =
        operationView.has_value() ? parseTimelineOperation(json, *operationView) : std::nullopt;
    const bool hasOperation = atSec.has_value() && operation.has_value();
    if (!hasOperation) {
      parsed.issue = "recording contains an invalid timeline operation";
      return parsed;
    }
    parsed.operations.push_back({*atSec, *operation, index});
  }
  for (const JsonView entry : *firedElements) {
    const auto atSec = numberProperty(json, entry, "atSec");
    const auto eventId = stringProperty(json, entry, "eventId");
    const bool hasFiredRecord = atSec.has_value() && eventId.has_value() && !eventId->empty();
    if (!hasFiredRecord) {
      parsed.issue = "recording contains an invalid fired record";
      return parsed;
    }
  }
  std::stable_sort(parsed.operations.begin(), parsed.operations.end(),
                   [](const ReplayOperation& left, const ReplayOperation& right) {
                     const bool hasDifferentTime = left.atSec != right.atSec;
                     return hasDifferentTime ? left.atSec < right.atSec
                                             : left.sourceIndex < right.sourceIndex;
                   });
  parsed.ok = true;
  return parsed;
}

} // namespace

ControlRequest parseControlRequest(const std::string& json) {
  ControlRequest request{};
  const auto root = rootObject(json);
  const bool hasRoot = root.has_value();
  if (!hasRoot) {
    request.issue = "request must be one JSON object";
    return request;
  }
  const auto id = numberProperty(json, *root, "id");
  const bool hasValidId = id.has_value() && *id >= 0.0 &&
                          *id <= std::numeric_limits<std::uint32_t>::max() &&
                          std::floor(*id) == *id;
  if (!hasValidId) {
    request.issue = "id must be a uint32";
    return request;
  }
  request.id = static_cast<std::uint32_t>(*id);

  const auto method = stringProperty(json, *root, "method");
  const bool hasMethod = method.has_value();
  if (!hasMethod) {
    request.issue = "method must be a string";
    return request;
  }
  request.method = methodFromName(*method);
  const bool hasKnownMethod = request.method != ControlMethod::Unknown;
  if (!hasKnownMethod) {
    request.issue = "unknown method";
    return request;
  }

  const auto params = objectProperty(json, *root, "params");
  const bool needsSeed = request.method == ControlMethod::ProposeSeed;
  const bool needsScene = request.method == ControlMethod::SetScene;
  const bool needsExternalId = request.method == ControlMethod::FireExternal;
  const bool needsText = needsSeed || needsScene || needsExternalId;
  if (needsText) {
    const std::string key = needsSeed ? "seed" : (needsScene ? "scene" : "id");
    const auto text = params.has_value() ? stringProperty(json, *params, key) : std::nullopt;
    const bool allowsEmptyText = needsSeed;
    const bool hasText = text.has_value() && (allowsEmptyText || !text->empty());
    if (!hasText) {
      request.issue =
          allowsEmptyText ? key + " must be a string" : key + " must be a non-empty string";
      return request;
    }
    const bool hasKnownScene =
        !needsScene || *text == "bars" || sceneFromId(*text) != SceneId::Bars;
    if (!hasKnownScene) {
      request.issue = "unknown scene";
      return request;
    }
    request.text = *text;
  }

  const bool needsDelta = request.method == ControlMethod::ShiftScene;
  const bool needsFactor = request.method == ControlMethod::TempoMultiply;
  const bool needsNumber = needsDelta || needsFactor;
  if (needsNumber) {
    const std::string key = needsDelta ? "delta" : "factor";
    const auto number = params.has_value() ? numberProperty(json, *params, key) : std::nullopt;
    const bool hasNumber = number.has_value();
    if (!hasNumber) {
      request.issue = key + " must be finite";
      return request;
    }
    const bool validDelta =
        !needsDelta || (std::floor(*number) == *number && std::abs(*number) <= 1000.0);
    const bool validFactor = !needsFactor || *number == 0.5 || *number == 2.0;
    if (!validDelta) {
      request.issue = "delta must be an integer in -1000..1000";
      return request;
    }
    if (!validFactor) {
      request.issue = "factor must be 0.5 or 2";
      return request;
    }
    request.number = static_cast<float>(*number);
  }

  const bool appliesTimelineOperation = request.method == ControlMethod::ApplyTimelineOp;
  if (appliesTimelineOperation) {
    const auto operationView =
        params.has_value() ? objectProperty(json, *params, "op") : std::nullopt;
    const auto operation =
        operationView.has_value() ? parseTimelineOperation(json, *operationView) : std::nullopt;
    const bool hasOperation = operation.has_value();
    if (!hasOperation) {
      request.issue = "params.op must be a valid timeline operation";
      return request;
    }
    request.timelineOperation = *operation;
  }

  const bool proposesPatch = request.method == ControlMethod::ProposePatch;
  if (proposesPatch) {
    const auto patch = params.has_value() ? objectProperty(json, *params, "patch") : std::nullopt;
    const bool isPatchObject =
        patch.has_value() && patch->end > patch->begin && json[patch->begin] == '{';
    if (!isPatchObject) {
      request.issue = "params.patch must be an object";
      return request;
    }
    const auto patchIssue = visualPatchIssue(json, *patch);
    const bool hasPatchIssue = patchIssue.has_value();
    if (hasPatchIssue) {
      request.issue = *patchIssue;
      return request;
    }
    const auto seed = stringProperty(json, *patch, "seed");
    const bool hasSeed = seed.has_value();
    if (!hasSeed) {
      request.issue = "patch.seed must be a string";
      return request;
    }
    request.intent.seed = *seed;
    request.intent.patchJson = json.substr(patch->begin, patch->end - patch->begin);
  }

  const bool setsImage = request.method == ControlMethod::SetImage;
  if (setsImage) {
    const auto name = params.has_value() ? stringProperty(json, *params, "name") : std::nullopt;
    const auto bytes =
        params.has_value() ? stringProperty(json, *params, "bytesBase64") : std::nullopt;
    const auto mime = params.has_value() ? stringProperty(json, *params, "mime") : std::nullopt;
    const bool hasImageFields = name.has_value() && bytes.has_value() && mime.has_value();
    if (!hasImageFields) {
      request.issue = "setImage requires string name, bytesBase64, and mime";
      return request;
    }
    request.text = *name;
    request.secondaryText = *mime;
    request.payload = *bytes;
  }

  const bool loadsRecording = request.method == ControlMethod::LoadRecording;
  if (loadsRecording) {
    const auto recording =
        params.has_value() ? stringProperty(json, *params, "json") : std::nullopt;
    const bool hasRecording = recording.has_value() && !recording->empty();
    if (!hasRecording) {
      request.issue = "params.json must be a non-empty string";
      return request;
    }
    request.text = *recording;
  }

  request.ok = true;
  return request;
}

ControlService::ControlService(RuntimeController& runtime, AudioAnalyzer& analyzer)
    : runtime_(runtime), analyzer_(analyzer) {}

TimeContext ControlService::timeContext(const AnalyzedAudioFrame& audio, double nowSec) const {
  return {nowSec, audio.tempo.barCount, audio.tempo.barPhase, audio.tempo.bpm, audio.tempo.locked};
}

bool ControlService::applyDueEvents(const std::vector<DueEvent>& dueEvents) {
  bool settingsChanged = false;
  for (const DueEvent& due : dueEvents) {
    const bool shouldRecord = recordingActive_;
    if (shouldRecord) {
      firedRecords_.push_back({due.firedAtSec, due.event.id});
    }
    settingsChanged =
        runtime_.applyIntent(due.event.intent, due.event.transition) || settingsChanged;
  }
  return settingsChanged;
}

ControlResult ControlService::dispatch(const ControlRequest& request,
                                       const AnalyzedAudioFrame& audio, std::uint64_t nowMs,
                                       std::uint32_t entropy) {
  const bool hasValidRequest = request.ok;
  if (!hasValidRequest) {
    const bool isPatchProposal = request.method == ControlMethod::ProposePatch;
    if (isPatchProposal) {
      return {"{\"id\":" + std::to_string(request.id) + ",\"result\":{\"ok\":false,\"issues\":[\"" +
                  escapeJson(request.issue) + "\"]}}",
              false};
    }
    return {encodeControlError(request.id, request.issue), false};
  }

  bool settingsChanged = false;
  switch (request.method) {
  case ControlMethod::GetState: {
    const ControlSnapshot snapshot{&runtime_.settings(),
                                   &audio.tempo,
                                   &timeline_,
                                   &scheduler_,
                                   &runtime_.patchJson(),
                                   runtime_.variationTransitionActive(),
                                   recordingActive_,
                                   static_cast<double>(nowMs) / 1000.0};
    return {encodeControlState(request.id, snapshot), false};
  }
  case ControlMethod::GetCatalog:
    return {"{\"id\":" + std::to_string(request.id) + ",\"result\":" + kGeneratorCatalogJson + "}",
            false};
  case ControlMethod::SetImage: {
    const auto image = images_.putBase64(request.text, request.payload, request.secondaryText);
    if (!image.ok || image.asset == nullptr) {
      return {"{\"id\":" + std::to_string(request.id) + ",\"result\":{\"ok\":false,\"issues\":[\"" +
                  escapeJson(image.issue) + "\"]}}",
              false};
    }
    return {"{\"id\":" + std::to_string(request.id) +
                ",\"result\":{\"ok\":true,\"issues\":[],\"hash\":\"" + image.asset->hash +
                "\",\"name\":\"" + escapeJson(image.asset->name) + "\"}}",
            false};
  }
  case ControlMethod::ProposePatch:
    settingsChanged = runtime_.applyIntent(request.intent, TransitionSpec{});
    break;
  case ControlMethod::ProposeSeed:
    settingsChanged = runtime_.applySeed(request.text, TransitionSpec{});
    break;
  case ControlMethod::SetScene: {
    auto settings = runtime_.settings();
    settings.scene = sceneFromId(request.text);
    runtime_.setSettings(std::move(settings));
    settingsChanged = true;
    break;
  }
  case ControlMethod::ShiftScene:
    runtime_.shiftScene(static_cast<int>(request.number));
    settingsChanged = true;
    break;
  case ControlMethod::Reroll:
    runtime_.reroll(entropy);
    settingsChanged = true;
    break;
  case ControlMethod::TapTempo:
    analyzer_.tapTempo(nowMs);
    break;
  case ControlMethod::TempoMultiply:
    analyzer_.tempoMultiply(request.number);
    break;
  case ControlMethod::TempoAuto:
    analyzer_.tempoAuto();
    break;
  case ControlMethod::ApplyTimelineOp: {
    const auto result = applyTimelineOp(timeline_, request.timelineOperation,
                                        timeContext(audio, static_cast<double>(nowMs) / 1000.0));
    const bool didApply = result.ok;
    if (didApply) {
      timeline_ = result.timeline;
      const bool shouldRecord = recordingActive_;
      if (shouldRecord) {
        recordedOperations_.push_back(
            {static_cast<double>(nowMs) / 1000.0, request.timelineOperation});
      }
    }
    return {encodeTimelineResult(request.id, result), false};
  }
  case ControlMethod::FireExternal: {
    const auto due = fireExternalEvents(timeline_, scheduler_, request.text,
                                        timeContext(audio, static_cast<double>(nowMs) / 1000.0));
    settingsChanged = applyDueEvents(due);
    break;
  }
  case ControlMethod::StartRecording: {
    const bool canStart = !recordingActive_;
    if (canStart) {
      recordingActive_ = true;
      recordingSessionSeed_ = runtime_.settings().seed;
      recordingInitialPatch_ = runtime_.patchJson();
      const bool needsFallbackPatch = recordingInitialPatch_.empty();
      if (needsFallbackPatch) {
        recordingInitialPatch_ = fallbackPatchJson(runtime_.settings(), runtime_.variation());
      }
      recordedOperations_.clear();
      firedRecords_.clear();
    }
    break;
  }
  case ControlMethod::StopRecording: {
    const bool hasRecording = recordingActive_;
    if (!hasRecording) {
      return {"{\"id\":" + std::to_string(request.id) + ",\"result\":{\"ok\":false,\"json\":null}}",
              false};
    }
    std::ostringstream recording;
    recording << "{\"schemaVersion\":1,\"engineVersion\":\"stackchan-core-1\","
              << "\"sessionSeed\":\"" << escapeJson(recordingSessionSeed_)
              << "\",\"initialPatch\":" << recordingInitialPatch_ << ",\"ops\":[";
    for (std::size_t index = 0; index < recordedOperations_.size(); ++index) {
      const RecordedOperation& entry = recordedOperations_[index];
      recording << (index > 0 ? "," : "") << "{\"atSec\":" << entry.atSec
                << ",\"op\":" << encodeTimelineOperation(entry.operation) << '}';
    }
    recording << "],\"fired\":[";
    for (std::size_t index = 0; index < firedRecords_.size(); ++index) {
      const FiredRecord& entry = firedRecords_[index];
      recording << (index > 0 ? "," : "") << "{\"atSec\":" << entry.atSec << ",\"eventId\":\""
                << escapeJson(entry.eventId) << "\"}";
    }
    recording << "]}";
    recordingActive_ = false;
    const std::string response = "{\"id\":" + std::to_string(request.id) +
                                 ",\"result\":{\"ok\":true,\"json\":\"" +
                                 escapeJson(recording.str()) + "\"}}";
    return {response, false};
  }
  case ControlMethod::LoadRecording: {
    const ParsedRecording parsed = parsePerformanceRecording(request.text);
    if (!parsed.ok) {
      const std::string response = "{\"id\":" + std::to_string(request.id) +
                                   ",\"result\":{\"ok\":false,\"issues\":[\"" +
                                   escapeJson(parsed.issue) + "\"]}}";
      return {response, false};
    }
    PerformanceTimeline replayed{};
    for (const ReplayOperation& entry : parsed.operations) {
      const TimeContext context{entry.atSec, 0, 0.0F, 0.0F, false};
      const auto result = applyTimelineOp(replayed, entry.operation, context);
      const bool didReplay = result.ok;
      if (didReplay) {
        replayed = result.timeline;
      }
    }
    timeline_ = std::move(replayed);
    scheduler_ = {};
    settingsChanged = runtime_.applyIntent(parsed.initialIntent, TransitionSpec{});
    return {"{\"id\":" + std::to_string(request.id) + ",\"result\":{\"ok\":true,\"issues\":[]}}",
            settingsChanged};
  }
  case ControlMethod::Unknown:
    return {encodeControlError(request.id, "unknown method"), false};
  }
  return {encodeControlAck(request.id), settingsChanged};
}

bool ControlService::updateTimeline(const AnalyzedAudioFrame& audio, double nowSec) {
  const auto due = collectDueEvents(timeline_, scheduler_, timeContext(audio, nowSec));
  return applyDueEvents(due);
}

const PerformanceTimeline& ControlService::timeline() const { return timeline_; }

const SchedulerState& ControlService::scheduler() const { return scheduler_; }

const ImageStore& ControlService::images() const { return images_; }

bool ControlService::recordingActive() const { return recordingActive_; }

std::string encodeControlError(std::uint32_t id, const std::string& issue) {
  return "{\"id\":" + std::to_string(id) + ",\"error\":\"" + escapeJson(issue) + "\"}";
}

std::string encodeControlAck(std::uint32_t id) {
  return "{\"id\":" + std::to_string(id) + ",\"result\":{\"ok\":true}}";
}

std::string encodeTimelineResult(std::uint32_t id, const TimelineOpResult& result) {
  std::ostringstream output;
  output << "{\"id\":" << id << ",\"result\":{\"ok\":" << (result.ok ? "true" : "false");
  const bool hasIssue = !result.issue.empty();
  if (hasIssue) {
    output << ",\"issue\":\"" << escapeJson(result.issue) << '"';
  }
  output << "}}";
  return output.str();
}

std::string encodeControlState(std::uint32_t id, const ControlSnapshot& snapshot) {
  const bool hasState = snapshot.settings != nullptr && snapshot.tempo != nullptr;
  if (!hasState) {
    return encodeControlError(id, "state unavailable");
  }
  const PerformanceTimeline emptyTimeline{};
  const SchedulerState emptyScheduler{};
  const PerformanceTimeline& timeline =
      snapshot.timeline != nullptr ? *snapshot.timeline : emptyTimeline;
  const SchedulerState& scheduler =
      snapshot.scheduler != nullptr ? *snapshot.scheduler : emptyScheduler;
  const bool hasPatch = snapshot.patchJson != nullptr && !snapshot.patchJson->empty();
  std::ostringstream output;
  output << std::fixed << std::setprecision(3) << "{\"id\":" << id << ",\"result\":{"
         << "\"currentPatch\":" << (hasPatch ? *snapshot.patchJson : "null")
         << ",\"timeline\":" << encodeTimeline(timeline) << ',' << "\"scene\":\""
         << escapeJson(sceneId(snapshot.settings->scene)) << "\","
         << "\"seed\":\"" << escapeJson(snapshot.settings->seed) << "\","
         << "\"bpm\":" << snapshot.tempo->bpm << ',' << "\"barCount\":" << snapshot.tempo->barCount
         << ',' << "\"barPhase\":" << snapshot.tempo->barPhase << ','
         << "\"tempoLocked\":" << (snapshot.tempo->locked ? "true" : "false") << ','
         << "\"tempoMode\":\"" << (snapshot.tempo->mode == TempoMode::Manual ? "manual" : "auto")
         << "\",\"qualityScale\":1,\"recordingActive\":"
         << (snapshot.recordingActive ? "true" : "false") << ','
         << "\"transitionActive\":" << (snapshot.transitionActive ? "true" : "false") << ','
         << "\"nowSec\":" << snapshot.nowSec << ",\"firedIds\":[";
  for (std::size_t index = 0; index < scheduler.firedIds.size(); ++index) {
    output << (index > 0 ? "," : "") << '"' << escapeJson(scheduler.firedIds[index]) << '"';
  }
  output << "]}}";
  return output.str();
}

} // namespace stackchan
