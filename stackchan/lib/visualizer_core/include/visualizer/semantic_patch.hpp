#pragma once

#include <string>

namespace stackchan {

[[nodiscard]] std::string deriveSemanticPatchJson(const std::string& seed,
                                                  const std::string& qualityTier = "medium");

} // namespace stackchan
