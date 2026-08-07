#include "visualizer/audio.hpp"

#include <algorithm>
#include <cmath>

namespace stackchan {
namespace {

constexpr float kPi = 3.14159265358979323846F;
constexpr float kEnvelopeBinMs = 10.0F;
constexpr std::size_t kLagMin = 30;
constexpr float kSilenceLevel = 0.015F;

float clamp(float value, float low, float high) { return std::clamp(value, low, high); }

float foldBpm(float bpm) {
  float folded = bpm;
  while (folded < 70.0F) {
    folded *= 2.0F;
  }
  while (folded > 180.0F) {
    folded *= 0.5F;
  }
  return folded;
}

} // namespace

float TempoTracker::effectiveBpm() const {
  const float base = mode_ == TempoMode::Manual ? manualBpm_ : baseBpm_;
  return base > 0.0F ? base * userMultiplier_ : 0.0F;
}

void TempoTracker::update(float onset, float level, std::uint64_t nowMs) {
  float deltaSeconds = 0.0F;
  if (updateInitialized_) {
    const std::uint64_t elapsedMs = nowMs >= lastUpdateMs_ ? nowMs - lastUpdateMs_ : 0;
    deltaSeconds = clamp(static_cast<float>(elapsedMs) / 1000.0F, 0.0F, 0.1F);
  }
  lastUpdateMs_ = nowMs;
  updateInitialized_ = true;
  averageLevel_ += (level - averageLevel_) * 0.05F;
  accumulateEnvelope(onset, nowMs);

  const bool isAnalysisDue = nowMs >= lastAnalysisMs_ + 500;
  if (isAnalysisDue) {
    lastAnalysisMs_ = nowMs;
    analyze(nowMs);
  }
  tickGrid(nowMs, deltaSeconds);
}

void TempoTracker::accumulateEnvelope(float onset, std::uint64_t nowMs) {
  const bool needsInitialization = !binInitialized_;
  if (needsInitialization) {
    binStartMs_ = nowMs;
    binInitialized_ = true;
  }
  binAccumulation_ = std::max(binAccumulation_, onset);

  while (nowMs >= binStartMs_ + static_cast<std::uint64_t>(kEnvelopeBinMs)) {
    envelope_[envelopeHead_] = binAccumulation_;
    envelopeHead_ = (envelopeHead_ + 1) % kEnvelopeBins;
    envelopeFilled_ = std::min(envelopeFilled_ + 1, kEnvelopeBins);
    binAccumulation_ = 0.0F;
    binStartMs_ += static_cast<std::uint64_t>(kEnvelopeBinMs);
    const bool didStall = nowMs > binStartMs_ + kEnvelopeBins * kEnvelopeBinMs;
    if (didStall) {
      binStartMs_ = nowMs;
      break;
    }
  }
}

void TempoTracker::analyze(std::uint64_t nowMs) {
  const bool hasEnoughHistory = envelopeFilled_ >= 300;
  if (!hasEnoughHistory) {
    return;
  }
  const bool isSilent = averageLevel_ < kSilenceLevel;
  if (isSilent) {
    confidence_ *= 0.95F;
    return;
  }

  const std::size_t count = envelopeFilled_;
  const std::size_t start = (envelopeHead_ + kEnvelopeBins - count) % kEnvelopeBins;
  float mean = 0.0F;
  for (std::size_t index = 0; index < count; ++index) {
    const float value = envelope_[(start + index) % kEnvelopeBins];
    scratchEnvelope_[index] = value;
    mean += value;
  }
  mean /= static_cast<float>(count);
  for (std::size_t index = 0; index < count; ++index) {
    scratchEnvelope_[index] -= mean;
  }

  const std::size_t maxLag = std::min(kLagMax, count - 1);
  float correlationSum = 0.0F;
  std::size_t correlationCount = 0;
  for (std::size_t lag = kLagMin; lag <= maxLag; ++lag) {
    float sum = 0.0F;
    for (std::size_t index = lag; index < count; ++index) {
      sum += scratchEnvelope_[index] * scratchEnvelope_[index - lag];
    }
    scratchCorrelation_[lag] = sum;
    correlationSum += std::abs(sum);
    ++correlationCount;
  }

  std::size_t bestLag = 0;
  float bestScore = -1.0F;
  for (std::size_t lag = kLagMin; lag <= maxLag; ++lag) {
    float score = scratchCorrelation_[lag];
    const std::size_t harmonic = lag * 2;
    const bool hasHarmonic = harmonic <= maxLag;
    if (hasHarmonic) {
      score += scratchCorrelation_[harmonic] * 0.5F;
    }
    const bool isBetter = score > bestScore;
    if (isBetter) {
      bestScore = score;
      bestLag = lag;
    }
  }
  const bool foundLag = bestLag > 0;
  if (!foundLag) {
    confidence_ *= 0.95F;
    return;
  }

  const float candidate = foldBpm(6000.0F / static_cast<float>(bestLag));
  const float correlationMean =
      correlationCount > 0 ? correlationSum / static_cast<float>(correlationCount) : 0.0F;
  const float prominence =
      correlationMean > 0.0F ? scratchCorrelation_[bestLag] / correlationMean : 0.0F;
  const float confidence = clamp((prominence - 1.0F) / 3.0F, 0.0F, 1.0F);
  updateBaseBpm(candidate, confidence);

  const bool usesAutomaticPhase = mode_ == TempoMode::Auto && effectiveBpm() > 0.0F;
  if (usesAutomaticPhase) {
    alignPhase(count, effectiveBpm(), nowMs);
  }
}

void TempoTracker::updateBaseBpm(float candidate, float confidence) {
  const bool isFirstLock = baseBpm_ <= 0.0F;
  if (isFirstLock) {
    baseBpm_ = candidate;
    confidence_ = confidence;
    pendingCandidate_ = 0.0F;
    return;
  }

  const bool isNearby = std::abs(candidate - baseBpm_) / baseBpm_ <= 0.02F;
  if (isNearby) {
    baseBpm_ += (candidate - baseBpm_) * 0.2F;
    pendingCandidate_ = 0.0F;
  } else {
    const bool confirmsPending =
        pendingCandidate_ > 0.0F &&
        std::abs(candidate - pendingCandidate_) / pendingCandidate_ <= 0.02F;
    if (confirmsPending) {
      baseBpm_ = candidate;
      pendingCandidate_ = 0.0F;
    } else {
      pendingCandidate_ = candidate;
    }
  }
  confidence_ += (confidence - confidence_) * 0.5F;
}

void TempoTracker::alignPhase(std::size_t count, float bpm, std::uint64_t nowMs) {
  const float periodMs = 60000.0F / bpm;
  const float periodBins = periodMs / kEnvelopeBinMs;
  const bool hasValidPeriod = periodBins >= 1.0F;
  if (!hasValidPeriod) {
    return;
  }

  float bestOffset = 0.0F;
  float bestEnergy = -1.0F;
  for (int step = 0; step < 24; ++step) {
    const float offset = static_cast<float>(step) / 24.0F * periodBins;
    float energy = 0.0F;
    for (int period = 0; period < 4; ++period) {
      const int center = static_cast<int>(std::round(static_cast<float>(count - 1) - offset -
                                                     static_cast<float>(period) * periodBins));
      for (int index = center - 1; index <= center + 1; ++index) {
        const bool isInRange = index >= 0 && static_cast<std::size_t>(index) < count;
        if (isInRange) {
          energy += scratchEnvelope_[static_cast<std::size_t>(index)];
        }
      }
    }
    const bool isBetter = energy > bestEnergy;
    if (isBetter) {
      bestEnergy = energy;
      bestOffset = offset;
    }
  }

  double target = static_cast<double>(nowMs) - bestOffset * kEnvelopeBinMs;
  while (target < static_cast<double>(nowMs)) {
    target += periodMs;
  }
  const bool needsGridInitialization = !gridInitialized_;
  if (needsGridInitialization) {
    nextBeatMs_ = target;
    gridInitialized_ = true;
    phaseLocked_ = true;
    return;
  }

  double difference = target - nextBeatMs_;
  difference -= std::round(difference / periodMs) * periodMs;
  const bool isFirstPhaseLock = !phaseLocked_;
  if (isFirstPhaseLock) {
    nextBeatMs_ += difference;
    phaseLocked_ = true;
    return;
  }
  const float maximumNudge = periodMs * 0.12F;
  nextBeatMs_ += clamp(static_cast<float>(difference), -maximumNudge, maximumNudge);
}

void TempoTracker::tickGrid(std::uint64_t nowMs, float deltaSeconds) {
  outputGridBeat_ = false;
  outputGridBar_ = false;
  const float bpm = effectiveBpm();
  const bool hasTempo = bpm > 0.0F;
  if (!hasTempo) {
    gridPulse_ *= std::exp(-deltaSeconds * 4.5F);
    barPulse_ *= std::exp(-deltaSeconds * 3.0F);
    return;
  }

  const double periodMs = 60000.0 / bpm;
  const bool needsGridInitialization = !gridInitialized_;
  if (needsGridInitialization) {
    nextBeatMs_ = static_cast<double>(nowMs) + periodMs;
    gridInitialized_ = true;
  }
  const bool isFarBehind = static_cast<double>(nowMs) - nextBeatMs_ > periodMs * 8.0;
  if (isFarBehind) {
    nextBeatMs_ = static_cast<double>(nowMs);
  }
  while (static_cast<double>(nowMs) >= nextBeatMs_) {
    ++beatIndex_;
    nextBeatMs_ += periodMs;
    outputGridBeat_ = true;
    gridPulse_ = 1.0F;
    const bool isDownbeat = beatIndex_ % 4 == 0;
    if (isDownbeat) {
      outputGridBar_ = true;
      barPulse_ = 1.0F;
    }
  }
  gridPulse_ *= std::exp(-deltaSeconds * 4.5F);
  barPulse_ *= std::exp(-deltaSeconds * 3.0F);
}

void TempoTracker::tap(std::uint64_t nowMs) {
  const bool hasTimedOut = tapCount_ > 0 && nowMs > taps_[tapCount_ - 1] + 2000;
  if (hasTimedOut) {
    tapCount_ = 0;
  }
  const bool isFull = tapCount_ == taps_.size();
  if (isFull) {
    std::move(taps_.begin() + 1, taps_.end(), taps_.begin());
    --tapCount_;
  }
  taps_[tapCount_++] = nowMs;
  const bool hasInterval = tapCount_ >= 2;
  if (!hasInterval) {
    return;
  }

  std::array<std::uint64_t, kTapCapacity - 1> intervals{};
  const std::size_t intervalCount = tapCount_ - 1;
  for (std::size_t index = 0; index < intervalCount; ++index) {
    intervals[index] = taps_[index + 1] - taps_[index];
  }
  std::sort(intervals.begin(), intervals.begin() + static_cast<std::ptrdiff_t>(intervalCount));
  const std::size_t middle = intervalCount / 2;
  const double median =
      intervalCount % 2 == 1
          ? static_cast<double>(intervals[middle])
          : (static_cast<double>(intervals[middle - 1]) + intervals[middle]) / 2.0;
  const bool hasValidMedian = median > 0.0;
  if (hasValidMedian) {
    manualBpm_ = static_cast<float>(60000.0 / median);
    mode_ = TempoMode::Manual;
    confidence_ = 1.0F;
    anchorGridToTap(nowMs);
  }
}

void TempoTracker::anchorGridToTap(std::uint64_t tapMs) {
  const float bpm = effectiveBpm();
  const bool hasTempo = bpm > 0.0F;
  if (!hasTempo) {
    return;
  }
  const double periodMs = 60000.0 / bpm;
  double target = static_cast<double>(tapMs) + periodMs;
  const std::uint64_t now = updateInitialized_ ? lastUpdateMs_ : tapMs;
  while (target <= static_cast<double>(now)) {
    target += periodMs;
  }
  nextBeatMs_ = target;
  gridInitialized_ = true;
}

void TempoTracker::multiply(float factor) {
  const bool isSupportedFactor = factor == 2.0F || factor == 0.5F;
  if (!isSupportedFactor) {
    return;
  }
  userMultiplier_ = clamp(userMultiplier_ * factor, 0.25F, 4.0F);
}

void TempoTracker::setAuto() {
  mode_ = TempoMode::Auto;
  userMultiplier_ = 1.0F;
}

TempoState TempoTracker::state() const {
  TempoState output{};
  output.bpm = effectiveBpm();
  const float periodMs = output.bpm > 0.0F ? 60000.0F / output.bpm : 0.0F;
  const bool canMeasurePhase = output.bpm > 0.0F && gridInitialized_ && periodMs > 0.0F;
  if (canMeasurePhase) {
    output.beatPhase =
        clamp(1.0F - static_cast<float>(nextBeatMs_ - lastUpdateMs_) / periodMs, 0.0F, 1.0F);
  }
  output.beatInBar = static_cast<int>(beatIndex_ % 4);
  output.barPhase = (static_cast<float>(output.beatInBar) + output.beatPhase) / 4.0F;
  output.barCount = static_cast<std::uint32_t>(beatIndex_ / 4);
  output.gridBeat = outputGridBeat_;
  output.gridBar = outputGridBar_;
  output.gridPulse = gridPulse_;
  output.barPulse = barPulse_;
  output.confidence = clamp(confidence_, 0.0F, 1.0F);
  output.locked = output.bpm > 0.0F && (mode_ == TempoMode::Manual || confidence_ > 0.35F);
  output.mode = mode_;
  return output;
}

AnalyzedAudioFrame AudioAnalyzer::process(const std::int16_t* samples, std::size_t count,
                                          std::uint32_t sampleRate, float gain,
                                          std::uint64_t nowMs) {
  const bool hasSamples = samples != nullptr && count > 0 && sampleRate > 0;
  if (!hasSamples) {
    tempo_.update(0.0F, 0.0F, nowMs);
    frame_.running = false;
    frame_.tempo = tempo_.state();
    return frame_;
  }

  double energy = 0.0;
  float peak = 0.0F;
  for (std::size_t index = 0; index < count; ++index) {
    const float sample = static_cast<float>(samples[index]) / 32768.0F;
    energy += static_cast<double>(sample) * sample;
    peak = std::max(peak, std::abs(sample));
  }
  for (std::size_t index = 0; index < frame_.waveform.size(); ++index) {
    const std::size_t sourceIndex = index * count / frame_.waveform.size();
    frame_.waveform[index] = static_cast<float>(samples[sourceIndex]) / 32768.0F;
  }

  for (std::size_t bin = 0; bin < frame_.spectrum.size(); ++bin) {
    const float frequency = (static_cast<float>(bin) + 1.0F) *
                            (static_cast<float>(sampleRate) * 0.5F) /
                            static_cast<float>(frame_.spectrum.size());
    float real = 0.0F;
    float imaginary = 0.0F;
    const bool canApplyHannWindow = count > 1;
    for (std::size_t index = 0; index < count; ++index) {
      const float sample = static_cast<float>(samples[index]) / 32768.0F;
      const float phase =
          2.0F * kPi * frequency * static_cast<float>(index) / static_cast<float>(sampleRate);
      const float window = canApplyHannWindow
                               ? 0.5F - 0.5F * std::cos(2.0F * kPi * static_cast<float>(index) /
                                                        static_cast<float>(count - 1))
                               : 1.0F;
      real += sample * window * std::cos(phase);
      imaginary -= sample * window * std::sin(phase);
    }
    frame_.spectrum[bin] =
        clamp(std::sqrt(real * real + imaginary * imaginary) * 4.0F / static_cast<float>(count),
              0.0F, 1.0F);
  }

  const float rootMeanSquare = static_cast<float>(std::sqrt(energy / count));
  const float rawBass = bandAverage(20.0F, 250.0F, sampleRate);
  const float rawMid = bandAverage(250.0F, 2000.0F, sampleRate);
  const float rawTreble = bandAverage(2000.0F, 16000.0F, sampleRate);
  smoothLevel_ += (rootMeanSquare - smoothLevel_) * 0.3F;
  smoothBass_ += (rawBass - smoothBass_) * 0.4F;
  smoothMid_ += (rawMid - smoothMid_) * 0.4F;
  smoothTreble_ += (rawTreble - smoothTreble_) * 0.4F;

  frame_.level = clamp(smoothLevel_ * gain, 0.0F, 1.0F);
  frame_.levelRaw = smoothLevel_;
  frame_.peak = peak;
  frame_.bass = clamp(smoothBass_ * gain, 0.0F, 1.0F);
  frame_.mid = clamp(smoothMid_ * gain, 0.0F, 1.0F);
  frame_.treble = clamp(smoothTreble_ * gain, 0.0F, 1.0F);
  frame_.beat = detectBeat(rawBass, nowMs);
  frame_.beatIntensity = beatIntensity_;
  frame_.running = true;
  const float onset = std::max(0.0F, rawBass - previousRawBass_);
  previousRawBass_ = rawBass;
  tempo_.update(onset, rootMeanSquare, nowMs);
  frame_.tempo = tempo_.state();
  return frame_;
}

float AudioAnalyzer::bandAverage(float lowHz, float highHz, std::uint32_t sampleRate) const {
  float sum = 0.0F;
  std::size_t count = 0;
  for (std::size_t bin = 0; bin < frame_.spectrum.size(); ++bin) {
    const float frequency = (static_cast<float>(bin) + 1.0F) *
                            (static_cast<float>(sampleRate) * 0.5F) /
                            static_cast<float>(frame_.spectrum.size());
    const bool isInBand = frequency >= lowHz && frequency < highHz;
    if (isInBand) {
      sum += frame_.spectrum[bin];
      ++count;
    }
  }
  return count > 0 ? sum / static_cast<float>(count) : 0.0F;
}

bool AudioAnalyzer::detectBeat(float rawBass, std::uint64_t nowMs) {
  beatIntensity_ *= 0.92F;
  float average = 0.0F;
  for (std::size_t index = 0; index < bassHistoryCount_; ++index) {
    average += bassHistory_[index];
  }
  average = bassHistoryCount_ > 0 ? average / static_cast<float>(bassHistoryCount_) : 0.0F;
  bassHistory_[bassHistoryHead_] = rawBass;
  bassHistoryHead_ = (bassHistoryHead_ + 1) % bassHistory_.size();
  bassHistoryCount_ = std::min(bassHistoryCount_ + 1, bassHistory_.size());

  const bool passedRefractory = nowMs >= lastBeatMs_ + 150;
  const bool exceedsFloor = rawBass > 0.02F;
  const bool exceedsAverage = average > 0.0F && rawBass > average * 1.35F;
  const bool detected = passedRefractory && exceedsFloor && exceedsAverage;
  if (detected) {
    lastBeatMs_ = nowMs;
    const float ratio = rawBass / average;
    beatIntensity_ = std::min(1.0F, (ratio - 1.0F) * 1.2F + 0.4F);
  }
  return detected;
}

void AudioAnalyzer::tapTempo(std::uint64_t nowMs) { tempo_.tap(nowMs); }

void AudioAnalyzer::tempoMultiply(float factor) { tempo_.multiply(factor); }

void AudioAnalyzer::tempoAuto() { tempo_.setAuto(); }

} // namespace stackchan
