#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace stackchan {

struct ImageAsset {
  std::string name;
  std::string mime;
  std::string hash;
  std::vector<std::uint8_t> bytes;
};

struct ImageStoreResult {
  bool ok = false;
  std::string issue;
  const ImageAsset* asset = nullptr;
};

class ImageStore {
public:
  ImageStoreResult putBase64(const std::string& name, const std::string& bytesBase64,
                             const std::string& mime);
  [[nodiscard]] const ImageAsset* get(const std::string& hash) const;
  [[nodiscard]] std::size_t size() const;

private:
  std::vector<ImageAsset> assets_;
};

} // namespace stackchan
