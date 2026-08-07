#pragma once

#include <optional>
#include <string>
#include <vector>

namespace stackchan {

[[nodiscard]] std::string deriveSemanticPatchJson(const std::string& seed,
                                                  const std::string& qualityTier = "medium");
[[nodiscard]] std::optional<std::string> semanticPatchSeed(const std::string& patchJson);
[[nodiscard]] std::vector<std::string> semanticPatchTopology(const std::string& patchJson);

} // namespace stackchan
