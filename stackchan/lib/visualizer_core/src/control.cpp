#include "visualizer/control.hpp"

#include <cctype>
#include <cmath>
#include <cstdlib>
#include <iomanip>
#include <limits>
#include <optional>
#include <sstream>

namespace stackchan {
namespace {

std::optional<std::size_t> valueStart(const std::string& json, const std::string& key) {
  const std::string marker = "\"" + key + "\"";
  const std::size_t keyPosition = json.find(marker);
  const bool foundKey = keyPosition != std::string::npos;
  if (!foundKey) {
    return std::nullopt;
  }
  const std::size_t colon = json.find(':', keyPosition + marker.size());
  const bool foundColon = colon != std::string::npos;
  if (!foundColon) {
    return std::nullopt;
  }
  std::size_t position = colon + 1;
  while (position < json.size() && std::isspace(static_cast<unsigned char>(json[position])) != 0) {
    ++position;
  }
  return position;
}

std::optional<std::string> stringProperty(const std::string& json, const std::string& key) {
  const auto start = valueStart(json, key);
  const bool startsWithQuote = start.has_value() && *start < json.size() && json[*start] == '"';
  if (!startsWithQuote) {
    return std::nullopt;
  }
  std::string output;
  bool escaped = false;
  for (std::size_t index = *start + 1; index < json.size(); ++index) {
    const char character = json[index];
    if (escaped) {
      switch (character) {
      case 'n':
        output.push_back('\n');
        break;
      case 'r':
        output.push_back('\r');
        break;
      case 't':
        output.push_back('\t');
        break;
      default:
        output.push_back(character);
        break;
      }
      escaped = false;
      continue;
    }
    const bool beginsEscape = character == '\\';
    if (beginsEscape) {
      escaped = true;
      continue;
    }
    const bool endsString = character == '"';
    if (endsString) {
      return output;
    }
    output.push_back(character);
  }
  return std::nullopt;
}

std::optional<double> numberProperty(const std::string& json, const std::string& key) {
  const auto start = valueStart(json, key);
  if (!start.has_value()) {
    return std::nullopt;
  }
  const char* first = json.c_str() + *start;
  char* end = nullptr;
  const double value = std::strtod(first, &end);
  const bool parsedNumber = end != first && std::isfinite(value);
  return parsedNumber ? std::optional<double>{value} : std::nullopt;
}

ControlMethod methodFromName(const std::string& name) {
  if (name == "getState") {
    return ControlMethod::GetState;
  }
  if (name == "proposeSeed") {
    return ControlMethod::ProposeSeed;
  }
  if (name == "setScene") {
    return ControlMethod::SetScene;
  }
  if (name == "shiftScene") {
    return ControlMethod::ShiftScene;
  }
  if (name == "reroll") {
    return ControlMethod::Reroll;
  }
  if (name == "tapTempo") {
    return ControlMethod::TapTempo;
  }
  if (name == "tempoMultiply") {
    return ControlMethod::TempoMultiply;
  }
  if (name == "tempoAuto") {
    return ControlMethod::TempoAuto;
  }
  return ControlMethod::Unknown;
}

std::string escapeJson(const std::string& value) {
  std::string output;
  output.reserve(value.size());
  for (const char character : value) {
    switch (character) {
    case '\\':
      output += "\\\\";
      break;
    case '"':
      output += "\\\"";
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
      output.push_back(character);
      break;
    }
  }
  return output;
}

} // namespace

ControlRequest parseControlRequest(const std::string& json) {
  ControlRequest request{};
  const auto id = numberProperty(json, "id");
  const bool hasValidId = id.has_value() && *id >= 0.0 &&
                          *id <= std::numeric_limits<std::uint32_t>::max() &&
                          std::floor(*id) == *id;
  if (!hasValidId) {
    request.issue = "id must be a uint32";
    return request;
  }
  request.id = static_cast<std::uint32_t>(*id);

  const auto method = stringProperty(json, "method");
  const bool hasMethod = method.has_value();
  if (!hasMethod) {
    request.issue = "method must be a string";
    return request;
  }
  request.method = methodFromName(*method);
  const bool knowsMethod = request.method != ControlMethod::Unknown;
  if (!knowsMethod) {
    request.issue = "unknown method";
    return request;
  }

  const bool needsSeed = request.method == ControlMethod::ProposeSeed;
  const bool needsScene = request.method == ControlMethod::SetScene;
  if (needsSeed || needsScene) {
    const std::string key = needsSeed ? "seed" : "scene";
    const auto text = stringProperty(json, key);
    const bool hasText = text.has_value() && !text->empty();
    if (!hasText) {
      request.issue = key + " must be a non-empty string";
      return request;
    }
    request.text = *text;
  }

  const bool needsDelta = request.method == ControlMethod::ShiftScene;
  const bool needsFactor = request.method == ControlMethod::TempoMultiply;
  if (needsDelta || needsFactor) {
    const std::string key = needsDelta ? "delta" : "factor";
    const auto number = numberProperty(json, key);
    const bool hasNumber = number.has_value();
    if (!hasNumber) {
      request.issue = key + " must be finite";
      return request;
    }
    request.number = static_cast<float>(*number);
  }

  request.ok = true;
  return request;
}

std::string encodeControlError(std::uint32_t id, const std::string& issue) {
  return "{\"id\":" + std::to_string(id) + ",\"error\":\"" + escapeJson(issue) + "\"}";
}

std::string encodeControlAck(std::uint32_t id) {
  return "{\"id\":" + std::to_string(id) + ",\"result\":{\"ok\":true}}";
}

std::string encodeControlState(std::uint32_t id, const ControlSnapshot& snapshot) {
  const bool hasState = snapshot.settings != nullptr && snapshot.tempo != nullptr;
  if (!hasState) {
    return encodeControlError(id, "state unavailable");
  }
  std::ostringstream output;
  output << std::fixed << std::setprecision(3) << "{\"id\":" << id << ",\"result\":{"
         << "\"scene\":\"" << escapeJson(sceneId(snapshot.settings->scene)) << "\","
         << "\"seed\":\"" << escapeJson(snapshot.settings->seed) << "\","
         << "\"bpm\":" << snapshot.tempo->bpm << ',' << "\"barCount\":" << snapshot.tempo->barCount
         << ',' << "\"barPhase\":" << snapshot.tempo->barPhase << ','
         << "\"tempoLocked\":" << (snapshot.tempo->locked ? "true" : "false") << ','
         << "\"tempoMode\":\"" << (snapshot.tempo->mode == TempoMode::Manual ? "manual" : "auto")
         << "\","
         << "\"transitionActive\":" << (snapshot.transitionActive ? "true" : "false") << ','
         << "\"nowSec\":" << snapshot.nowSec << "}}";
  return output.str();
}

} // namespace stackchan
