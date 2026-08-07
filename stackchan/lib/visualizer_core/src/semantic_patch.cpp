#include "visualizer/semantic_patch.hpp"

#include "visualizer/generated_catalog.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <iomanip>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

namespace stackchan {
namespace {

struct DerivedOperator {
  std::string id;
  const GeneratedGeneratorDefinition* generator = nullptr;
  std::vector<std::pair<std::string, std::string>> parameters;
};

struct RouteTarget {
  std::string key;
  double minimum = 0.0;
  double maximum = 0.0;
};

struct DerivedRoute {
  std::string source;
  std::string target;
  double amount = 0.0;
  std::string polarity;
  double smoothing = 0.8;
};

std::vector<std::uint16_t> toUtf16(const std::string& text) {
  std::vector<std::uint16_t> units;
  for (std::size_t index = 0; index < text.size();) {
    const auto first = static_cast<std::uint8_t>(text[index]);
    std::uint32_t codePoint = 0xFFFDU;
    std::size_t sequenceSize = 1;
    const bool isAscii = first < 0x80U;
    const bool isTwoByte = (first & 0xE0U) == 0xC0U && index + 1 < text.size();
    const bool isThreeByte = (first & 0xF0U) == 0xE0U && index + 2 < text.size();
    const bool isFourByte = (first & 0xF8U) == 0xF0U && index + 3 < text.size();
    if (isAscii) {
      codePoint = first;
    } else if (isTwoByte) {
      codePoint = ((first & 0x1FU) << 6U) | (static_cast<std::uint8_t>(text[index + 1]) & 0x3FU);
      sequenceSize = 2;
    } else if (isThreeByte) {
      codePoint = ((first & 0x0FU) << 12U) |
                  ((static_cast<std::uint8_t>(text[index + 1]) & 0x3FU) << 6U) |
                  (static_cast<std::uint8_t>(text[index + 2]) & 0x3FU);
      sequenceSize = 3;
    } else if (isFourByte) {
      codePoint = ((first & 0x07U) << 18U) |
                  ((static_cast<std::uint8_t>(text[index + 1]) & 0x3FU) << 12U) |
                  ((static_cast<std::uint8_t>(text[index + 2]) & 0x3FU) << 6U) |
                  (static_cast<std::uint8_t>(text[index + 3]) & 0x3FU);
      sequenceSize = 4;
    }
    index += sequenceSize;
    const bool needsSurrogatePair = codePoint > 0xFFFFU;
    if (needsSurrogatePair) {
      const std::uint32_t surrogate = codePoint - 0x10000U;
      units.push_back(static_cast<std::uint16_t>(0xD800U + (surrogate >> 10U)));
      units.push_back(static_cast<std::uint16_t>(0xDC00U + (surrogate & 0x3FFU)));
    } else {
      units.push_back(static_cast<std::uint16_t>(codePoint));
    }
  }
  return units;
}

std::uint32_t fnv1a32(const std::string& text) {
  std::uint32_t hash = 0x811C9DC5U;
  for (const std::uint16_t unit : toUtf16(text)) {
    hash ^= unit;
    hash *= 0x01000193U;
  }
  return hash;
}

std::uint32_t hashU32(std::uint32_t value) {
  value ^= value >> 16U;
  value *= 0x7FEB352DU;
  value ^= value >> 15U;
  value *= 0x846CA68BU;
  value ^= value >> 16U;
  return value;
}

std::uint32_t hashCombine(std::uint32_t left, std::uint32_t right) {
  return hashU32(left ^ hashU32(right));
}

double namedRandom(const std::string& seed, const std::string& nameSpace, std::uint32_t index) {
  const std::uint32_t hash = hashCombine(hashCombine(fnv1a32(seed), fnv1a32(nameSpace)), index);
  return static_cast<double>(hash >> 8U) / 16777216.0;
}

double multiplyThenAdd(double left, double right, double addend) {
  // JavaScriptと同じく乗算時に一度binary64へ丸めてから加算する。
  volatile double product = left * right;
  return product + addend;
}

int randomInteger(const std::string& seed, const std::string& nameSpace, int minimum, int maximum) {
  const bool hasRange = maximum > minimum;
  if (!hasRange) {
    return minimum;
  }
  const double value = namedRandom(seed, nameSpace, 0);
  return std::min(maximum, minimum + static_cast<int>(std::floor(value * (maximum - minimum + 1))));
}

std::string escapeJson(const std::string& value) {
  std::string output;
  output.reserve(value.size());
  for (const unsigned char character : value) {
    const bool escapesQuote = character == '"';
    const bool escapesSlash = character == '\\';
    const bool escapesControl = character < 0x20U;
    if (escapesQuote) {
      output += "\\\"";
    } else if (escapesSlash) {
      output += "\\\\";
    } else if (escapesControl) {
      std::ostringstream escaped;
      escaped << "\\u" << std::hex << std::setw(4) << std::setfill('0')
              << static_cast<int>(character);
      output += escaped.str();
    } else {
      output.push_back(static_cast<char>(character));
    }
  }
  return output;
}

std::string numberJson(double value) {
  std::ostringstream output;
  output << std::setprecision(17) << value;
  return output.str();
}

bool generatorNeedsTexture(const std::string& generatorId) {
  for (std::size_t index = 0; index < kTextureDefinitionCount; ++index) {
    const bool matches = generatorId == kTextureDefinitions[index].generatorId;
    if (matches) {
      return true;
    }
  }
  return false;
}

double resolutionScale(const std::string& qualityTier) {
  const bool usesLow = qualityTier == "low";
  const bool usesMedium = qualityTier == "medium";
  if (usesLow) {
    return 0.5;
  }
  return usesMedium ? 0.75 : 1.0;
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

bool fitsBudget(const std::vector<DerivedOperator>& operators, const std::string& qualityTier) {
  double total = 0.0;
  int passes = 0;
  int heavy = 0;
  int stateful = 0;
  const double scale = resolutionScale(qualityTier);
  for (const auto& operation : operators) {
    const auto& definition = *operation.generator;
    total += costWeight(definition.costClass) * definition.relativeFill * scale * scale;
    passes += definition.passes;
    heavy += std::string(definition.costClass) == "heavy" ? 1 : 0;
    stateful += definition.stateful ? 1 : 0;
  }
  const double maximumCost =
      qualityTier == "low" ? 50.0 : (qualityTier == "medium" ? 120.0 : 250.0);
  const int maximumPasses = qualityTier == "low" ? 2 : (qualityTier == "medium" ? 4 : 8);
  const int maximumHeavy = qualityTier == "low" ? 0 : (qualityTier == "medium" ? 1 : 2);
  const int maximumStateful = qualityTier == "low" ? 1 : (qualityTier == "medium" ? 2 : 3);
  return total <= maximumCost && passes <= maximumPasses && heavy <= maximumHeavy &&
         stateful <= maximumStateful;
}

bool fitsBudgetAlone(const GeneratedGeneratorDefinition& definition,
                     const std::string& qualityTier) {
  const DerivedOperator probe{"probe", &definition, {}};
  return fitsBudget({probe}, qualityTier);
}

std::vector<const GeneratedGeneratorDefinition*> generatorPool(const std::string& category,
                                                               const std::string& qualityTier) {
  std::vector<const GeneratedGeneratorDefinition*> output;
  for (std::size_t index = 0; index < kGeneratorDefinitionCount; ++index) {
    const auto& definition = kGeneratorDefinitions[index];
    const bool matchesCategory = category == definition.category;
    const bool needsTexture = generatorNeedsTexture(definition.id);
    const bool canFit = fitsBudgetAlone(definition, qualityTier);
    if (matchesCategory && !needsTexture && canFit) {
      output.push_back(&definition);
    }
  }
  return output;
}

bool containsId(const std::vector<std::string>& ids, const std::string& id) {
  return std::find(ids.begin(), ids.end(), id) != ids.end();
}

const GeneratedGeneratorDefinition*
pickGenerator(const std::string& seed, const std::string& slot,
              const std::vector<const GeneratedGeneratorDefinition*>& candidates) {
  const GeneratedGeneratorDefinition* best = candidates.front();
  double bestWeight = namedRandom(seed, "patch:pick:" + slot, fnv1a32(best->id));
  for (std::size_t index = 1; index < candidates.size(); ++index) {
    const auto* candidate = candidates[index];
    const double weight = namedRandom(seed, "patch:pick:" + slot, fnv1a32(candidate->id));
    const bool isBetter = weight > bestWeight;
    if (isBetter) {
      best = candidate;
      bestWeight = weight;
    }
  }
  return best;
}

std::vector<std::string> enumOptions(const std::string& options) {
  std::vector<std::string> output;
  std::size_t begin = 0;
  while (begin <= options.size()) {
    const std::size_t separator = options.find('|', begin);
    const std::size_t end = separator == std::string::npos ? options.size() : separator;
    output.push_back(options.substr(begin, end - begin));
    const bool reachedEnd = separator == std::string::npos;
    if (reachedEnd) {
      break;
    }
    begin = separator + 1;
  }
  return output;
}

std::string parameterJson(const std::string& seed, const std::string& operatorId,
                          const GeneratedParameterDefinition& parameter) {
  const std::string nameSpace = "patch:param:" + operatorId + ":" + parameter.id;
  const std::string kind = parameter.kind;
  const bool isNumber = kind == "number";
  const bool isInteger = kind == "int";
  const bool isBoolean = kind == "bool";
  if (isNumber) {
    const double value = multiplyThenAdd(namedRandom(seed, nameSpace, 0),
                                         parameter.maximum - parameter.minimum, parameter.minimum);
    return numberJson(value);
  }
  if (isInteger) {
    return std::to_string(randomInteger(seed, nameSpace, static_cast<int>(parameter.minimum),
                                        static_cast<int>(parameter.maximum)));
  }
  if (isBoolean) {
    return namedRandom(seed, nameSpace, 0) < 0.5 ? "true" : "false";
  }
  const auto options = enumOptions(parameter.options);
  const int index = randomInteger(seed, nameSpace, 0, static_cast<int>(options.size()) - 1);
  return "\"" + escapeJson(options[static_cast<std::size_t>(index)]) + "\"";
}

DerivedOperator buildOperator(const std::string& seed, const std::string& id,
                              const GeneratedGeneratorDefinition& generator) {
  DerivedOperator operation{id, &generator, {}};
  for (std::size_t index = 0; index < kParameterDefinitionCount; ++index) {
    const auto& parameter = kParameterDefinitions[index];
    const bool matchesGenerator = std::string(parameter.generatorId) == generator.id;
    if (matchesGenerator) {
      operation.parameters.push_back({parameter.id, parameterJson(seed, id, parameter)});
    }
  }
  return operation;
}

std::vector<DerivedOperator>
pickCategory(const std::string& seed, int count,
             const std::vector<const GeneratedGeneratorDefinition*>& pool,
             std::vector<std::string>& chosenIds, const std::string& idPrefix,
             const std::string& slotPrefix) {
  std::vector<DerivedOperator> output;
  for (int index = 0; index < count; ++index) {
    std::vector<const GeneratedGeneratorDefinition*> candidates;
    for (const auto* definition : pool) {
      const bool wasChosen = containsId(chosenIds, definition->id);
      if (!wasChosen) {
        candidates.push_back(definition);
      }
    }
    const bool hasCandidates = !candidates.empty();
    if (!hasCandidates) {
      break;
    }
    const auto* picked = pickGenerator(seed, slotPrefix + std::to_string(index), candidates);
    chosenIds.push_back(picked->id);
    output.push_back(buildOperator(seed, idPrefix + std::to_string(index), *picked));
  }
  return output;
}

bool stripOneOperator(std::vector<DerivedOperator>& operators) {
  std::array<std::vector<std::size_t>, 4> indices;
  for (std::size_t index = 0; index < operators.size(); ++index) {
    const std::string category = operators[index].generator->category;
    const int rank =
        category == "source" ? 0 : (category == "field" ? 1 : (category == "modifier" ? 2 : 3));
    indices[static_cast<std::size_t>(rank)].push_back(index);
  }
  std::size_t dropIndex = 0;
  const bool canDropField = !indices[1].empty();
  const bool canDropModifier = indices[2].size() > 1;
  const bool canDropSource = indices[0].size() > 1;
  if (canDropField) {
    dropIndex = indices[1].back();
  } else if (canDropModifier) {
    dropIndex = indices[2].back();
  } else if (canDropSource) {
    dropIndex = indices[0].back();
  } else {
    return false;
  }
  operators.erase(operators.begin() + static_cast<std::ptrdiff_t>(dropIndex));
  return true;
}

std::vector<RouteTarget> routeTargets(const std::vector<DerivedOperator>& operators) {
  std::vector<RouteTarget> output;
  for (const auto& operation : operators) {
    for (std::size_t index = 0; index < kParameterDefinitionCount; ++index) {
      const auto& parameter = kParameterDefinitions[index];
      const bool matchesGenerator = std::string(parameter.generatorId) == operation.generator->id;
      const std::string kind = parameter.kind;
      const bool isNumeric = kind == "number" || kind == "int";
      const bool hasRange = parameter.hasRange && parameter.maximum > parameter.minimum;
      const bool isTarget = matchesGenerator && parameter.modulatable && isNumeric && hasRange;
      if (isTarget) {
        output.push_back({operation.id + "." + parameter.id, parameter.minimum, parameter.maximum});
      }
    }
  }
  return output;
}

std::string pickString(const std::string& seed, const std::string& nameSpace,
                       const std::vector<std::string>& candidates) {
  std::string best = candidates.front();
  double bestWeight = namedRandom(seed, nameSpace, fnv1a32(best));
  for (std::size_t index = 1; index < candidates.size(); ++index) {
    const double weight = namedRandom(seed, nameSpace, fnv1a32(candidates[index]));
    const bool isBetter = weight > bestWeight;
    if (isBetter) {
      best = candidates[index];
      bestWeight = weight;
    }
  }
  return best;
}

std::vector<DerivedRoute> buildRoutes(const std::string& seed,
                                      const std::vector<DerivedOperator>& operators) {
  auto targets = routeTargets(operators);
  const bool hasTargets = !targets.empty();
  if (!hasTargets) {
    return {};
  }
  constexpr std::array<const char*, 6> kSources = {"audio:bass",      "audio:mid",
                                                   "audio:treble",    "audio:level",
                                                   "audio:beatPhase", "audio:barPhase"};
  std::vector<std::string> sources(kSources.begin(), kSources.end());
  const int count =
      std::min(randomInteger(seed, "patch:route:count", 1, 3), static_cast<int>(targets.size()));
  std::vector<DerivedRoute> output;
  for (int index = 0; index < count; ++index) {
    const std::string prefix = "patch:route:" + std::to_string(index);
    const std::string source = pickString(seed, prefix + ":source", sources);
    std::vector<std::string> targetKeys;
    targetKeys.reserve(targets.size());
    for (const auto& target : targets) {
      targetKeys.push_back(target.key);
    }
    const std::string targetKey = pickString(seed, prefix + ":target", targetKeys);
    const auto target =
        std::find_if(targets.begin(), targets.end(),
                     [&targetKey](const auto& item) { return item.key == targetKey; });
    const double ratio = multiplyThenAdd(namedRandom(seed, prefix + ":amount", 0), 0.3, 0.1);
    const double amount = (target->maximum - target->minimum) * ratio;
    const std::string polarity =
        namedRandom(seed, prefix + ":polarity", 0) < 0.8 ? "unipolar" : "bipolar";
    const double centered = multiplyThenAdd(namedRandom(seed, prefix + ":smoothing", 0), 2.0, -1.0);
    const double smoothingRaw = multiplyThenAdd(centered, 0.4, 0.8);
    const double smoothing = std::clamp(smoothingRaw, 0.4, 1.6);
    output.push_back({source, target->key, amount, polarity, smoothing});
    targets.erase(target);
  }
  return output;
}

std::string serializePatch(const std::string& seed, const std::string& qualityTier,
                           const std::vector<DerivedOperator>& operators,
                           const std::vector<DerivedRoute>& routes) {
  constexpr std::array<const char*, 5> kPaletteModes = {"mono", "analogous", "complementary",
                                                        "triadic", "rainbow"};
  const int paletteIndex = randomInteger(seed, "patch:palette:mode", 0, 4);
  std::ostringstream output;
  output << std::setprecision(17) << "{\"schemaVersion\":1,\"seed\":\"" << escapeJson(seed)
         << "\",\"operators\":[";
  for (std::size_t index = 0; index < operators.size(); ++index) {
    const auto& operation = operators[index];
    output << (index > 0 ? "," : "") << "{\"id\":\"" << operation.id << "\",\"generatorId\":\""
           << operation.generator->id << "\",\"generatorVersion\":" << operation.generator->version
           << ",\"parameters\":{";
    for (std::size_t parameterIndex = 0; parameterIndex < operation.parameters.size();
         ++parameterIndex) {
      const auto& parameter = operation.parameters[parameterIndex];
      output << (parameterIndex > 0 ? "," : "") << "\"" << parameter.first
             << "\":" << parameter.second;
    }
    output << "}}";
  }
  output << "],\"routes\":[";
  for (std::size_t index = 0; index < routes.size(); ++index) {
    const auto& route = routes[index];
    output << (index > 0 ? "," : "") << "{\"source\":\"" << route.source << "\",\"target\":\""
           << route.target << "\",\"amount\":" << route.amount << ",\"polarity\":\""
           << route.polarity << "\",\"smoothing\":" << route.smoothing << "}";
  }
  output << "],\"palette\":{\"mode\":\"" << kPaletteModes[paletteIndex]
         << "\",\"hueOffset\":" << namedRandom(seed, "patch:palette:hue", 0) * 360.0
         << ",\"saturation\":" << namedRandom(seed, "patch:palette:sat", 0) * 100.0
         << ",\"lightness\":" << namedRandom(seed, "patch:palette:lit", 0) * 100.0
         << "},\"composition\":{\"symmetry\":" << randomInteger(seed, "patch:comp:symmetry", 1, 8)
         << ",\"scale\":" << multiplyThenAdd(namedRandom(seed, "patch:comp:scale", 0), 1.5, 0.5)
         << ",\"speed\":" << multiplyThenAdd(namedRandom(seed, "patch:comp:speed", 0), 1.75, 0.25)
         << "},\"qualityTier\":\"" << qualityTier << "\"}";
  return output.str();
}

} // namespace

std::string deriveSemanticPatchJson(const std::string& seed, const std::string& qualityTier) {
  const std::string safeQuality =
      qualityTier == "low" || qualityTier == "high" ? qualityTier : "medium";
  const auto sourcePool = generatorPool("source", safeQuality);
  const auto fieldPool = generatorPool("field", safeQuality);
  const auto modifierPool = generatorPool("modifier", safeQuality);
  const auto materialPool = generatorPool("material", safeQuality);
  const int sourceCount = std::min(randomInteger(seed, "patch:count:source", 1, 2),
                                   static_cast<int>(sourcePool.size()));
  const int fieldCount =
      std::min(randomInteger(seed, "patch:count:field", 0, 2), static_cast<int>(fieldPool.size()));
  const int modifierCount = std::min(randomInteger(seed, "patch:count:modifier", 1, 3),
                                     static_cast<int>(modifierPool.size()));
  const int materialCount = std::min(1, static_cast<int>(materialPool.size()));

  std::vector<std::string> chosenIds;
  auto operators = pickCategory(seed, sourceCount, sourcePool, chosenIds, "src", "source");
  auto fields = pickCategory(seed, fieldCount, fieldPool, chosenIds, "fld", "field");
  auto modifiers = pickCategory(seed, modifierCount, modifierPool, chosenIds, "mod", "modifier");
  auto materials = pickCategory(seed, materialCount, materialPool, chosenIds, "mat", "material");
  operators.insert(operators.end(), fields.begin(), fields.end());
  operators.insert(operators.end(), modifiers.begin(), modifiers.end());
  operators.insert(operators.end(), materials.begin(), materials.end());
  for (int attempt = 0; attempt < 32 && !fitsBudget(operators, safeQuality); ++attempt) {
    const bool didStrip = stripOneOperator(operators);
    if (!didStrip) {
      break;
    }
  }
  const auto routes = buildRoutes(seed, operators);
  return serializePatch(seed, safeQuality, operators, routes);
}

} // namespace stackchan
