#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

namespace stackchan {

constexpr std::size_t kSpectrumSize = 32;
constexpr std::size_t kWaveformSize = 128;

enum class TempoMode { Auto, Manual };

struct TempoState {
  float bpm = 0.0F;
  float beatPhase = 0.0F;
  float barPhase = 0.0F;
  int beatInBar = 0;
  std::uint32_t barCount = 0;
  bool gridBeat = false;
  bool gridBar = false;
  float gridPulse = 0.0F;
  float barPulse = 0.0F;
  float confidence = 0.0F;
  bool locked = false;
  TempoMode mode = TempoMode::Auto;
};

struct AnalyzedAudioFrame {
  std::array<float, kSpectrumSize> spectrum{};
  std::array<float, kWaveformSize> waveform{};
  float level = 0.0F;
  float levelRaw = 0.0F;
  float peak = 0.0F;
  float bass = 0.0F;
  float mid = 0.0F;
  float treble = 0.0F;
  bool beat = false;
  float beatIntensity = 0.0F;
  bool running = false;
  TempoState tempo{};
};

class TempoTracker {
public:
  void update(float onset, float level, std::uint64_t nowMs);
  void tap(std::uint64_t nowMs);
  void multiply(float factor);
  void setAuto();
  [[nodiscard]] TempoState state() const;

private:
  static constexpr std::size_t kEnvelopeBins = 600;
  static constexpr std::size_t kLagMax = 100;
  static constexpr std::size_t kTapCapacity = 7;

  void accumulateEnvelope(float onset, std::uint64_t nowMs);
  void analyze(std::uint64_t nowMs);
  void updateBaseBpm(float candidate, float confidence);
  void alignPhase(std::size_t count, float bpm, std::uint64_t nowMs);
  void tickGrid(std::uint64_t nowMs, float deltaSeconds);
  void anchorGridToTap(std::uint64_t tapMs);
  [[nodiscard]] float effectiveBpm() const;

  std::array<float, kEnvelopeBins> envelope_{};
  std::array<float, kEnvelopeBins> scratchEnvelope_{};
  std::array<float, kLagMax + 1> scratchCorrelation_{};
  std::size_t envelopeHead_ = 0;
  std::size_t envelopeFilled_ = 0;
  float binAccumulation_ = 0.0F;
  std::uint64_t binStartMs_ = 0;
  bool binInitialized_ = false;
  std::uint64_t lastUpdateMs_ = 0;
  bool updateInitialized_ = false;
  std::uint64_t lastAnalysisMs_ = 0;
  float averageLevel_ = 0.0F;
  float baseBpm_ = 0.0F;
  float manualBpm_ = 0.0F;
  TempoMode mode_ = TempoMode::Auto;
  float userMultiplier_ = 1.0F;
  float confidence_ = 0.0F;
  float pendingCandidate_ = 0.0F;
  std::uint64_t beatIndex_ = 0;
  double nextBeatMs_ = 0.0;
  bool gridInitialized_ = false;
  bool phaseLocked_ = false;
  float gridPulse_ = 0.0F;
  float barPulse_ = 0.0F;
  bool outputGridBeat_ = false;
  bool outputGridBar_ = false;
  std::array<std::uint64_t, kTapCapacity> taps_{};
  std::size_t tapCount_ = 0;
};

class AudioAnalyzer {
public:
  AnalyzedAudioFrame process(const std::int16_t* samples, std::size_t count,
                             std::uint32_t sampleRate, float gain, std::uint64_t nowMs);
  void tapTempo(std::uint64_t nowMs);
  void tempoMultiply(float factor);
  void tempoAuto();

private:
  static constexpr std::size_t kBeatHistorySize = 43;

  [[nodiscard]] float bandAverage(float lowHz, float highHz, std::uint32_t sampleRate) const;
  bool detectBeat(float rawBass, std::uint64_t nowMs);

  AnalyzedAudioFrame frame_{};
  TempoTracker tempo_{};
  std::array<float, kBeatHistorySize> bassHistory_{};
  std::size_t bassHistoryCount_ = 0;
  std::size_t bassHistoryHead_ = 0;
  float smoothLevel_ = 0.0F;
  float smoothBass_ = 0.0F;
  float smoothMid_ = 0.0F;
  float smoothTreble_ = 0.0F;
  float beatIntensity_ = 0.0F;
  float previousRawBass_ = 0.0F;
  std::uint64_t lastBeatMs_ = 0;
};

} // namespace stackchan
