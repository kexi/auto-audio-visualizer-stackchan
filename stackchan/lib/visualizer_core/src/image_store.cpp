#include "visualizer/image_store.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdint>
#include <iomanip>
#include <optional>
#include <sstream>
#include <utility>

namespace stackchan {
namespace {

constexpr std::array<std::uint32_t, 64> kSha256Constants = {
    0x428A2F98U, 0x71374491U, 0xB5C0FBCFU, 0xE9B5DBA5U, 0x3956C25BU, 0x59F111F1U, 0x923F82A4U,
    0xAB1C5ED5U, 0xD807AA98U, 0x12835B01U, 0x243185BEU, 0x550C7DC3U, 0x72BE5D74U, 0x80DEB1FEU,
    0x9BDC06A7U, 0xC19BF174U, 0xE49B69C1U, 0xEFBE4786U, 0x0FC19DC6U, 0x240CA1CCU, 0x2DE92C6FU,
    0x4A7484AAU, 0x5CB0A9DCU, 0x76F988DAU, 0x983E5152U, 0xA831C66DU, 0xB00327C8U, 0xBF597FC7U,
    0xC6E00BF3U, 0xD5A79147U, 0x06CA6351U, 0x14292967U, 0x27B70A85U, 0x2E1B2138U, 0x4D2C6DFCU,
    0x53380D13U, 0x650A7354U, 0x766A0ABBU, 0x81C2C92EU, 0x92722C85U, 0xA2BFE8A1U, 0xA81A664BU,
    0xC24B8B70U, 0xC76C51A3U, 0xD192E819U, 0xD6990624U, 0xF40E3585U, 0x106AA070U, 0x19A4C116U,
    0x1E376C08U, 0x2748774CU, 0x34B0BCB5U, 0x391C0CB3U, 0x4ED8AA4AU, 0x5B9CCA4FU, 0x682E6FF3U,
    0x748F82EEU, 0x78A5636FU, 0x84C87814U, 0x8CC70208U, 0x90BEFFFAU, 0xA4506CEBU, 0xBEF9A3F7U,
    0xC67178F2U,
};

std::uint32_t rotateRight(std::uint32_t value, std::uint32_t bits) {
  return (value >> bits) | (value << (32U - bits));
}

std::string sha256(const std::vector<std::uint8_t>& input) {
  std::vector<std::uint8_t> message = input;
  const std::uint64_t bitLength = static_cast<std::uint64_t>(message.size()) * 8U;
  message.push_back(0x80U);
  while (message.size() % 64U != 56U) {
    message.push_back(0U);
  }
  for (int shift = 56; shift >= 0; shift -= 8) {
    message.push_back(static_cast<std::uint8_t>((bitLength >> shift) & 0xFFU));
  }

  std::array<std::uint32_t, 8> hash = {0x6A09E667U, 0xBB67AE85U, 0x3C6EF372U, 0xA54FF53AU,
                                       0x510E527FU, 0x9B05688CU, 0x1F83D9ABU, 0x5BE0CD19U};
  for (std::size_t offset = 0; offset < message.size(); offset += 64U) {
    std::array<std::uint32_t, 64> words{};
    for (std::size_t index = 0; index < 16; ++index) {
      const std::size_t byte = offset + index * 4U;
      words[index] = (static_cast<std::uint32_t>(message[byte]) << 24U) |
                     (static_cast<std::uint32_t>(message[byte + 1]) << 16U) |
                     (static_cast<std::uint32_t>(message[byte + 2]) << 8U) |
                     static_cast<std::uint32_t>(message[byte + 3]);
    }
    for (std::size_t index = 16; index < words.size(); ++index) {
      const std::uint32_t first = rotateRight(words[index - 15], 7U) ^
                                  rotateRight(words[index - 15], 18U) ^ (words[index - 15] >> 3U);
      const std::uint32_t second = rotateRight(words[index - 2], 17U) ^
                                   rotateRight(words[index - 2], 19U) ^ (words[index - 2] >> 10U);
      words[index] = words[index - 16] + first + words[index - 7] + second;
    }

    std::uint32_t a = hash[0];
    std::uint32_t b = hash[1];
    std::uint32_t c = hash[2];
    std::uint32_t d = hash[3];
    std::uint32_t e = hash[4];
    std::uint32_t f = hash[5];
    std::uint32_t g = hash[6];
    std::uint32_t h = hash[7];
    for (std::size_t index = 0; index < words.size(); ++index) {
      const std::uint32_t sigmaOne = rotateRight(e, 6U) ^ rotateRight(e, 11U) ^ rotateRight(e, 25U);
      const std::uint32_t choice = (e & f) ^ (~e & g);
      const std::uint32_t first = h + sigmaOne + choice + kSha256Constants[index] + words[index];
      const std::uint32_t sigmaZero =
          rotateRight(a, 2U) ^ rotateRight(a, 13U) ^ rotateRight(a, 22U);
      const std::uint32_t majority = (a & b) ^ (a & c) ^ (b & c);
      const std::uint32_t second = sigmaZero + majority;
      h = g;
      g = f;
      f = e;
      e = d + first;
      d = c;
      c = b;
      b = a;
      a = first + second;
    }
    hash[0] += a;
    hash[1] += b;
    hash[2] += c;
    hash[3] += d;
    hash[4] += e;
    hash[5] += f;
    hash[6] += g;
    hash[7] += h;
  }

  std::ostringstream output;
  output << std::hex << std::setfill('0');
  for (const std::uint32_t word : hash) {
    output << std::setw(8) << word;
  }
  return output.str();
}

std::optional<std::uint8_t> base64Value(char character) {
  const bool isUpper = character >= 'A' && character <= 'Z';
  const bool isLower = character >= 'a' && character <= 'z';
  const bool isDigit = character >= '0' && character <= '9';
  if (isUpper) {
    return static_cast<std::uint8_t>(character - 'A');
  }
  if (isLower) {
    return static_cast<std::uint8_t>(character - 'a' + 26);
  }
  if (isDigit) {
    return static_cast<std::uint8_t>(character - '0' + 52);
  }
  const bool isPlus = character == '+';
  const bool isSlash = character == '/';
  if (isPlus) {
    return 62U;
  }
  return isSlash ? std::optional<std::uint8_t>{63U} : std::nullopt;
}

std::optional<std::vector<std::uint8_t>> decodeBase64(const std::string& input) {
  std::string compact;
  compact.reserve(input.size());
  for (const unsigned char character : input) {
    const bool isWhitespace = std::isspace(character) != 0;
    if (!isWhitespace) {
      compact.push_back(static_cast<char>(character));
    }
  }
  const bool hasValidLength = !compact.empty() && compact.size() % 4U == 0U;
  if (!hasValidLength) {
    return std::nullopt;
  }
  std::vector<std::uint8_t> output;
  output.reserve(compact.size() / 4U * 3U);
  for (std::size_t offset = 0; offset < compact.size(); offset += 4U) {
    std::array<std::uint8_t, 4> values{};
    int padding = 0;
    for (std::size_t index = 0; index < 4; ++index) {
      const char character = compact[offset + index];
      const bool isPadding = character == '=';
      if (isPadding) {
        ++padding;
        values[index] = 0;
      } else {
        const auto value = base64Value(character);
        const bool hasValue = value.has_value() && padding == 0;
        if (!hasValue) {
          return std::nullopt;
        }
        values[index] = *value;
      }
    }
    const bool hasValidPadding = padding <= 2 && (padding == 0 || offset + 4U == compact.size());
    if (!hasValidPadding) {
      return std::nullopt;
    }
    const std::uint32_t block = (static_cast<std::uint32_t>(values[0]) << 18U) |
                                (static_cast<std::uint32_t>(values[1]) << 12U) |
                                (static_cast<std::uint32_t>(values[2]) << 6U) |
                                static_cast<std::uint32_t>(values[3]);
    output.push_back(static_cast<std::uint8_t>((block >> 16U) & 0xFFU));
    const bool hasSecondByte = padding < 2;
    const bool hasThirdByte = padding == 0;
    if (hasSecondByte) {
      output.push_back(static_cast<std::uint8_t>((block >> 8U) & 0xFFU));
    }
    if (hasThirdByte) {
      output.push_back(static_cast<std::uint8_t>(block & 0xFFU));
    }
  }
  return output;
}

std::string trimmed(const std::string& value) {
  const auto first = std::find_if_not(value.begin(), value.end(), [](unsigned char character) {
    return std::isspace(character) != 0;
  });
  const auto last = std::find_if_not(value.rbegin(), value.rend(), [](unsigned char character) {
                      return std::isspace(character) != 0;
                    }).base();
  const bool hasText = first < last;
  return hasText ? std::string(first, last) : std::string{};
}

} // namespace

ImageStoreResult ImageStore::putBase64(const std::string& name, const std::string& bytesBase64,
                                       const std::string& mime) {
  const std::string safeName = trimmed(name);
  const bool hasName = !safeName.empty();
  if (!hasName) {
    return {false, "image name must not be empty", nullptr};
  }
  auto decoded = decodeBase64(bytesBase64);
  const bool hasPayload = decoded.has_value() && !decoded->empty();
  if (!hasPayload) {
    return {false, "invalid or empty base64 payload", nullptr};
  }
  const std::string hash = sha256(*decoded);
  const auto existing = std::find_if(assets_.begin(), assets_.end(),
                                     [&hash](const ImageAsset& item) { return item.hash == hash; });
  const bool alreadyStored = existing != assets_.end();
  if (alreadyStored) {
    existing->name = safeName;
    existing->mime = mime;
    return {true, {}, &*existing};
  }
  assets_.push_back({safeName, mime, hash, std::move(*decoded)});
  return {true, {}, &assets_.back()};
}

const ImageAsset* ImageStore::get(const std::string& hash) const {
  const auto match = std::find_if(assets_.begin(), assets_.end(),
                                  [&hash](const ImageAsset& item) { return item.hash == hash; });
  return match == assets_.end() ? nullptr : &*match;
}

std::size_t ImageStore::size() const { return assets_.size(); }

} // namespace stackchan
