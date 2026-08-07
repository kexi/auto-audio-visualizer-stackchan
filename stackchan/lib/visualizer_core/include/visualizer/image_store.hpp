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
  std::string storagePath;
};

struct ImageStoreResult {
  bool ok = false;
  std::string issue;
  const ImageAsset* asset = nullptr;
};

class ImageStore {
public:
  ImageStoreResult beginBase64(const std::string& name, const std::string& mime,
                               std::size_t expectedBytes);
  ImageStoreResult appendBase64(const std::string& bytesBase64);
  ImageStoreResult commitBase64();
  void cancelBase64();
  ImageStoreResult putBase64(const std::string& name, const std::string& bytesBase64,
                             const std::string& mime);
  ImageStoreResult putBytes(const std::string& name, std::vector<std::uint8_t> bytes,
                            const std::string& mime);
  bool markPersisted(const std::string& hash, const std::string& storagePath);
  [[nodiscard]] const ImageAsset* get(const std::string& hash) const;
  [[nodiscard]] const ImageAsset* latest() const;
  [[nodiscard]] std::size_t size() const;
  [[nodiscard]] bool uploadActive() const;

private:
  struct PendingUpload {
    std::string name;
    std::string mime;
    std::size_t expectedBytes = 0;
    std::vector<std::uint8_t> bytes;
  };

  std::vector<ImageAsset> assets_;
  std::string lastTouchedHash_;
  PendingUpload pending_{};
  bool uploadActive_ = false;
};

} // namespace stackchan
