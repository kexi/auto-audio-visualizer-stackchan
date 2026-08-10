#include "visualizer/audio.hpp"
#include "visualizer/control.hpp"
#include "visualizer/generated_catalog.hpp"
#include "visualizer/headbang.hpp"
#include "visualizer/quality.hpp"
#include "visualizer/runtime.hpp"
#include "visualizer/scene_renderer.hpp"
#include "visualizer/semantic_patch.hpp"
#include "visualizer/settings.hpp"
#include "visualizer/timeline.hpp"
#include "visualizer/variation.hpp"
#include "visualizer/visualizer.hpp"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <optional>
#include <unordered_set>
#include <vector>

namespace {

bool isNear(float actual, float expected, float tolerance) {
  return std::abs(actual - expected) <= tolerance;
}

std::string minimalPatchJson(const std::string& seed) {
  return "{\"schemaVersion\":1,\"seed\":\"" + seed +
         "\",\"operators\":[{\"id\":\"src0\",\"generatorId\":\"grid\","
         "\"generatorVersion\":1,\"parameters\":{\"cells\":8,\"thickness\":0.08}},"
         "{\"id\":\"mod0\",\"generatorId\":\"spin\",\"generatorVersion\":1,"
         "\"parameters\":{\"rate\":0.4,\"wobble\":0.2}},{\"id\":\"mat0\","
         "\"generatorId\":\"neon\",\"generatorVersion\":1,\"parameters\":{"
         "\"hue\":200,\"intensity\":1.2}}],\"routes\":[],\"palette\":{\"mode\":"
         "\"mono\",\"hueOffset\":200,\"saturation\":80,\"lightness\":55},"
         "\"composition\":{\"symmetry\":4,\"scale\":1,\"speed\":1},"
         "\"qualityTier\":\"medium\"}";
}

std::string quoteJsonString(const std::string& value) {
  std::string output = "\"";
  for (const char character : value) {
    const bool needsEscape = character == '\\' || character == '"';
    if (needsEscape) {
      output.push_back('\\');
    }
    output.push_back(character);
  }
  output.push_back('"');
  return output;
}

class CountingCanvas final : public stackchan::Canvas {
public:
  explicit CountingCanvas(int width = 320, int height = 240) : width_(width), height_(height) {}

  [[nodiscard]] int width() const override { return width_; }
  [[nodiscard]] int height() const override { return height_; }
  void clear(stackchan::Color color) override {
    ++operations;
    lastClearAlpha = color.alpha;
    mix(color.red, color.green, color.blue + color.alpha);
  }
  void line(int x1, int y1, int x2, int y2, stackchan::Color color, int) override {
    ++operations;
    mix(x1 + x2, y1 + y2, color.red);
  }
  void rectangle(int x, int y, int width, int height, stackchan::Color color, bool) override {
    ++operations;
    mix(x + width, y + height, color.green);
  }
  void circle(int x, int y, int radius, stackchan::Color color, bool) override {
    ++operations;
    mix(x + radius, y, color.blue);
  }
  void text(int x, int y, const std::string& value, stackchan::Color color) override {
    ++operations;
    mix(x + static_cast<int>(value.size()), y, color.red);
  }
  bool image(const stackchan::ImageAsset& asset, int x, int y, int width, int height) override {
    ++operations;
    ++imageOperations;
    mix(x + width, y + height, static_cast<int>(asset.bytes.size()));
    return true;
  }

  int operations = 0;
  int imageOperations = 0;
  std::uint8_t lastClearAlpha = 255;
  std::uint32_t fingerprint = 2166136261U;

private:
  int width_ = 320;
  int height_ = 240;

  void mix(int first, int second, int third) {
    fingerprint ^= static_cast<std::uint32_t>(first);
    fingerprint *= 16777619U;
    fingerprint ^= static_cast<std::uint32_t>(second);
    fingerprint *= 16777619U;
    fingerprint ^= static_cast<std::uint32_t>(third);
    fingerprint *= 16777619U;
  }
};

} // namespace

int main() {
  stackchan::Visualizer visualizer;

  // 入力値が範囲外でも、描画状態が正規化された範囲に収まることを保証する。
  visualizer.update({2.0F, -1.0F, 3.0F, 2.0F}, 1.0F);
  const auto& state = visualizer.state();
  assert(state.mouthOpen >= 0.0F && state.mouthOpen <= 1.0F);
  assert(state.eyeSquint >= 0.0F && state.eyeSquint <= 1.0F);
  for (const float bar : state.bars) {
    assert(bar >= 0.0F && bar <= 1.0F);
  }

  // 無音へ遷移したときに、口の開きが即時消失せず滑らかに減衰することを保証する。
  const float loudMouth = state.mouthOpen;
  visualizer.update({}, 0.016F);
  assert(visualizer.state().mouthOpen > 0.0F);
  assert(visualizer.state().mouthOpen < loudMouth);

  // 同一seedがホストとCoreS3で同一Variationを生成することを保証する。
  const auto variation = stackchan::generateVariation("neon-prism-001");
  const auto repeatedVariation = stackchan::generateVariation("neon-prism-001");
  assert(variation.baseSeed == repeatedVariation.baseSeed);
  assert(variation.variant == repeatedVariation.variant);
  assert(isNear(variation.random(42), repeatedVariation.random(42), 0.000001F));
  assert(variation.paletteMode == stackchan::PaletteMode::Analogous);
  assert(isNear(variation.hueOffset, 144.313206F, 0.0001F));
  assert(variation.symmetry == 3);
  assert(variation.variant == 1);
  assert(isNear(variation.random(42), 0.410899376F, 0.000001F));

  // Unicode seedもJavaScriptのUTF-16規則と同じlookを生成することを保証する。
  const auto unicodeVariation = stackchan::generateVariation("日本語🎛️");
  assert(unicodeVariation.paletteMode == stackchan::PaletteMode::Complementary);
  assert(isNear(unicodeVariation.hueOffset, 47.0012168F, 0.0001F));
  assert(unicodeVariation.symmetry == 2);
  assert(unicodeVariation.variant == 2);
  assert(isNear(unicodeVariation.random(42), 0.0743598582F, 0.000001F));

  // 設定値がブラウザ版と同じ公開範囲へ正規化されることを保証する。
  stackchan::Settings unsafeSettings{};
  unsafeSettings.gain = 99.0F;
  unsafeSettings.cycleSeconds = -5.0F;
  unsafeSettings.cycleBars = 0;
  unsafeSettings.gachaBars = 999;
  unsafeSettings.seed = "   ";
  const auto safeSettings = stackchan::sanitizeSettings(unsafeSettings);
  assert(safeSettings.gain == 4.0F);
  assert(safeSettings.cycleSeconds == 2.0F);
  assert(safeSettings.cycleBars == 1);
  assert(safeSettings.gachaBars == 512);
  assert(safeSettings.seed == "neon-prism-001");
  assert(stackchan::shiftedScene(stackchan::SceneId::Bars, -1) ==
         stackchan::SceneId::SemanticSynth);

  // 高負荷が持続したときだけ品質を一段下げ、resetで最高品質へ戻ることを保証する。
  stackchan::QualityController quality;
  assert(isNear(quality.update(30.0F, 0.0), 1.0F, 0.000001F));
  assert(isNear(quality.update(30.0F, 1999.0), 1.0F, 0.000001F));
  assert(isNear(quality.update(30.0F, 2000.0), 0.75F, 0.000001F));
  for (int nowMs = 2001; nowMs < 6000; ++nowMs) {
    quality.update(1.0F, static_cast<double>(nowMs));
  }
  assert(isNear(quality.scale(), 0.75F, 0.000001F));
  assert(isNear(quality.update(1.0F, 6000.0), 1.0F, 0.000001F));
  quality.reset();
  assert(isNear(quality.scale(), 1.0F, 0.000001F));

  // seedからのSemantic Patch導出が決定的で、共通のPatch検証ゲートを通ることを保証する。
  const std::string derivedPatch = stackchan::deriveSemanticPatchJson("portable-neon-042");
  assert(derivedPatch == stackchan::deriveSemanticPatchJson("portable-neon-042"));
  const auto derivedPatchRequest = stackchan::parseControlRequest(
      R"({"id":16,"method":"proposePatch","params":{"patch":)" + derivedPatch + "}}");
  assert(derivedPatchRequest.ok);
  assert(stackchan::semanticPatchSeed(R"({"seed":"日本語\uD83C\uDF9B\uFE0F"})") ==
         std::optional<std::string>{"日本語🎛️"});
  const auto escapedTopology = stackchan::semanticPatchTopology(
      R"({"operators":[{"id":"src\"x","generatorId":"grid","generatorVersion":1,"parameters":{"label":"}"}}]})");
  assert(escapedTopology.size() == 1);
  assert(escapedTopology[0].rfind("src\"x", 0) == 0);

  // Web版が公開する全Audio modulation sourceをCoreS3のPatch検証も受理することを保証する。
  constexpr std::array<const char*, 3> extendedAudioSources = {"audio:beatIntensity",
                                                               "audio:gridPulse", "audio:barPulse"};
  for (const char* source : extendedAudioSources) {
    std::string sourcePatch = minimalPatchJson("audio-source-validation");
    sourcePatch.replace(sourcePatch.find("\"routes\":[]"), 11,
                        std::string{"\"routes\":[{\"source\":\""} + source +
                            "\",\"target\":\"src0.cells\",\"amount\":1,\"polarity\":\"unipolar\","
                            "\"smoothing\":0}]");
    const auto sourceRequest = stackchan::parseControlRequest(
        R"({"id":17,"method":"proposePatch","params":{"patch":)" + sourcePatch + "}}");
    assert(sourceRequest.ok);
  }
  std::string unsupportedOperatorSource = minimalPatchJson("operator-source-validation");
  unsupportedOperatorSource.replace(
      unsupportedOperatorSource.find("\"routes\":[]"), 11,
      R"("routes":[{"source":"operator:mod0","target":"src0.cells","amount":1,"polarity":"unipolar","smoothing":0}])");
  const auto unsupportedOperatorRequest = stackchan::parseControlRequest(
      R"({"id":18,"method":"proposePatch","params":{"patch":)" + unsupportedOperatorSource + "}}");
  assert(!unsupportedOperatorRequest.ok);
  assert(unsupportedOperatorRequest.issue.find("not supported yet") != std::string::npos);

  // 500ms間隔のタップが120 BPMの手動グリッドを生成することを保証する。
  stackchan::TempoTracker tempo;
  tempo.update(0.0F, 0.0F, 1000);
  tempo.tap(1000);
  tempo.tap(1500);
  tempo.update(0.0F, 0.0F, 1500);
  assert(tempo.state().mode == stackchan::TempoMode::Manual);
  assert(isNear(tempo.state().bpm, 120.0F, 0.01F));
  tempo.update(0.0F, 0.0F, 2000);
  stackchan::HeadbangController tappedHeadbang;
  assert(tappedHeadbang.update(tempo.state(), 0.5F).shouldMove);
  tempo.multiply(2.0F);
  assert(isNear(tempo.state().bpm, 240.0F, 0.01F));
  tempo.setAuto();
  assert(tempo.state().mode == stackchan::TempoMode::Auto);

  // 120 BPMの規則的なonset列から自動テンポがロックすることを保証する。
  stackchan::TempoTracker automaticTempo;
  stackchan::HeadbangController automaticHeadbang;
  int automaticHeadbangCount = 0;
  int previousAutomaticPitch = -1;
  for (std::uint64_t nowMs = 0; nowMs <= 20000; nowMs += 10) {
    const bool isKick = nowMs % 500U == 0U;
    automaticTempo.update(isKick ? 1.0F : 0.0F, 0.5F, nowMs);
    const auto command = automaticHeadbang.update(automaticTempo.state(), isKick ? 1.0F : 0.0F);
    const bool didMove = command.shouldMove;
    if (didMove) {
      const bool hasPreviousPitch = previousAutomaticPitch >= 0;
      if (hasPreviousPitch) {
        const bool movedDown = command.pitch < 350;
        const bool previouslyMovedDown = previousAutomaticPitch < 350;
        assert(movedDown != previouslyMovedDown);
      }
      previousAutomaticPitch = command.pitch;
      ++automaticHeadbangCount;
    }
  }
  assert(automaticTempo.state().locked);
  assert(isNear(automaticTempo.state().bpm, 120.0F, 1.0F));
  assert(automaticHeadbangCount >= 20);
  for (std::uint64_t nowMs = 20010; nowMs <= 22010; nowMs += 10) {
    automaticTempo.update(0.0F, 0.0F, nowMs);
  }
  assert(!automaticTempo.state().locked);
  assert(automaticTempo.state().bpm == 0.0F);

  // ロック済みの各拍で首が上下交互に動き、同じ拍を二重処理しないことを保証する。
  stackchan::HeadbangController headbang;
  stackchan::TempoState headbangTempo{};
  headbangTempo.locked = true;
  headbangTempo.gridBeat = true;
  headbangTempo.beatInBar = 1;
  const auto downwardHeadbang = headbang.update(headbangTempo, -1.0F);
  assert(downwardHeadbang.shouldMove);
  assert(downwardHeadbang.yaw == 0);
  assert(downwardHeadbang.pitch == 210);
  assert(downwardHeadbang.speed == 600);
  assert(!headbang.update(headbangTempo, 1.0F).shouldMove);
  headbangTempo.beatInBar = 2;
  const auto upwardHeadbang = headbang.update(headbangTempo, 2.0F);
  assert(upwardHeadbang.shouldMove);
  assert(upwardHeadbang.pitch == 700);
  assert(upwardHeadbang.speed == 950);
  headbangTempo.locked = false;
  headbangTempo.gridBeat = false;
  const auto centeredHeadbang = headbang.update(headbangTempo, 0.0F);
  assert(centeredHeadbang.shouldMove);
  assert(centeredHeadbang.yaw == 0);
  assert(centeredHeadbang.pitch == 350);
  assert(centeredHeadbang.speed == 400);
  assert(!headbang.update(headbangTempo, 0.0F).shouldMove);

  // テンポが未ロックの拍ではサーボ指令を出さないことを保証する。
  stackchan::HeadbangController unlockedHeadbang;
  assert(!unlockedHeadbang.update(headbangTempo, 1.0F).shouldMove);

  // PCM解析がRMS・ピーク・波形・帯域を有限の正規化値として返すことを保証する。
  std::array<std::int16_t, 256> samples{};
  for (std::size_t index = 0; index < samples.size(); ++index) {
    samples[index] = static_cast<std::int16_t>(
        std::sin(static_cast<float>(index) * 2.0F * 3.14159265F * 4.0F / samples.size()) *
        12000.0F);
  }
  stackchan::AudioAnalyzer analyzer;
  const auto analyzed = analyzer.process(samples.data(), samples.size(), 16000, 1.5F, 2000);
  assert(analyzed.running);
  assert(analyzed.level > 0.0F && analyzed.level <= 1.0F);
  assert(analyzed.peak > 0.3F && analyzed.peak < 0.4F);
  assert(analyzed.waveform[1] != 0.0F);
  assert(analyzed.spectrum[0] > 0.3F);
  assert(analyzed.spectrum[0] > analyzed.spectrum[1] * 10.0F);
  assert(analyzed.bass > 0.1F);

  // 小音量の周期的な低音でもgainを上げると自動BPMがロックすることを保証する。
  std::array<std::int16_t, 256> backgroundSamples{};
  std::array<std::int16_t, 256> kickSamples{};
  for (std::size_t index = 0; index < backgroundSamples.size(); ++index) {
    const float time = static_cast<float>(index) / 16000.0F;
    const float background = std::sin(2.0F * 3.14159265F * 1000.0F * time) * 300.0F;
    const float kick = std::sin(2.0F * 3.14159265F * 250.0F * time) * 500.0F;
    backgroundSamples[index] = static_cast<std::int16_t>(background);
    kickSamples[index] = static_cast<std::int16_t>(background + kick);
  }
  stackchan::AudioAnalyzer quietAutomaticAnalyzer;
  stackchan::AudioAnalyzer boostedAutomaticAnalyzer;
  stackchan::AnalyzedAudioFrame quietAutomaticFrame{};
  stackchan::AnalyzedAudioFrame boostedAutomaticFrame{};
  for (std::uint64_t nowMs = 0; nowMs <= 20000; nowMs += 20) {
    const bool isKick = nowMs % 500U == 0U;
    const auto& currentSamples = isKick ? kickSamples : backgroundSamples;
    quietAutomaticFrame = quietAutomaticAnalyzer.process(currentSamples.data(),
                                                         currentSamples.size(), 16000, 1.0F, nowMs);
    boostedAutomaticFrame = boostedAutomaticAnalyzer.process(
        currentSamples.data(), currentSamples.size(), 16000, 4.0F, nowMs);
  }
  assert(!quietAutomaticFrame.tempo.locked);
  assert(boostedAutomaticFrame.tempo.locked);
  assert(isNear(boostedAutomaticFrame.tempo.bpm, 120.0F, 1.0F));

  // サーボ動作音を除外すると無音後に自動BPMが解除されることを保証する。
  stackchan::AudioAnalyzer ungatedFeedbackAnalyzer = boostedAutomaticAnalyzer;
  stackchan::AudioAnalyzer gatedFeedbackAnalyzer = boostedAutomaticAnalyzer;
  stackchan::AnalyzedAudioFrame ungatedFeedbackFrame{};
  stackchan::AnalyzedAudioFrame gatedFeedbackFrame{};
  std::array<std::int16_t, 256> silenceSamples{};
  std::array<std::int16_t, 256> motorSamples{};
  for (std::size_t index = 0; index < motorSamples.size(); ++index) {
    const float time = static_cast<float>(index) / 16000.0F;
    motorSamples[index] =
        static_cast<std::int16_t>(std::sin(2.0F * 3.14159265F * 250.0F * time) * 500.0F);
  }
  for (std::uint64_t nowMs = 20020; nowMs <= 24020; nowMs += 20) {
    const std::uint64_t elapsedMs = nowMs - 20020;
    const bool startsServoMotion = elapsedMs % 500U == 0U;
    if (startsServoMotion) {
      gatedFeedbackAnalyzer.suppressMotionNoise(nowMs);
    }
    const bool hasMotorNoise = elapsedMs % 500U == 20U;
    const auto& feedbackSamples = hasMotorNoise ? motorSamples : silenceSamples;
    ungatedFeedbackFrame = ungatedFeedbackAnalyzer.process(
        feedbackSamples.data(), feedbackSamples.size(), 16000, 4.0F, nowMs);
    gatedFeedbackFrame = gatedFeedbackAnalyzer.process(feedbackSamples.data(),
                                                       feedbackSamples.size(), 16000, 4.0F, nowMs);
  }
  assert(ungatedFeedbackFrame.tempo.locked);
  assert(!gatedFeedbackFrame.tempo.locked);
  assert(gatedFeedbackFrame.tempo.bpm == 0.0F);

  // 1サンプルの入力でもスペクトル値がNaNにならないことを保証する。
  const std::int16_t singleSample = 1200;
  const auto singleAnalyzed = analyzer.process(&singleSample, 1, 16000, 1.5F, 2010);
  for (const float bin : singleAnalyzed.spectrum) {
    assert(std::isfinite(bin));
  }

  // PCMが途切れても手動テンポのフリーホイールが進み続けることを保証する。
  stackchan::AudioAnalyzer freewheelAnalyzer;
  freewheelAnalyzer.tapTempo(1000);
  freewheelAnalyzer.tapTempo(1500);
  const auto silentFreewheel = freewheelAnalyzer.process(nullptr, 0, 16000, 1.5F, 2000);
  assert(!silentFreewheel.running);
  assert(silentFreewheel.tempo.mode == stackchan::TempoMode::Manual);
  assert(isNear(silentFreewheel.tempo.bpm, 120.0F, 0.01F));

  // 秒指定のオートサイクルと小節指定の自動ガチャが独立に発火することを保証する。
  stackchan::Settings runtimeSettings{};
  runtimeSettings.autoCycle = true;
  runtimeSettings.cycleSeconds = 2.0F;
  runtimeSettings.autoGacha = true;
  runtimeSettings.gachaBars = 2;
  stackchan::RuntimeController runtime(runtimeSettings);
  stackchan::AnalyzedAudioFrame runtimeAudio{};
  runtimeAudio.tempo.bpm = 120.0F;
  runtimeAudio.tempo.barCount = 2;
  const auto runtimeUpdate = runtime.update(runtimeAudio, 2.0F, 1234);
  assert(runtimeUpdate.sceneChanged);
  assert(runtimeUpdate.variationChanged);
  assert(runtime.settings().scene == stackchan::SceneId::Waveform);

  // ガチャ後のlookがease-in-out補間され、所定時間後にseedへ収束することを保証する。
  stackchan::RuntimeController transitionRuntime;
  const float initialHue = transitionRuntime.variation().hueOffset;
  transitionRuntime.reroll(9876);
  assert(transitionRuntime.variationTransitionActive());
  transitionRuntime.update({}, 0.6F, 0);
  const float middleHue = transitionRuntime.variation().hueOffset;
  assert(!isNear(middleHue, initialHue, 0.0001F));
  transitionRuntime.update({}, 0.6F, 0);
  assert(!transitionRuntime.variationTransitionActive());
  assert(transitionRuntime.variation().seed == transitionRuntime.settings().seed);

  // TimelineのPatch intentが決定的なCPU表現へ変換され、指定時間で遷移することを保証する。
  stackchan::SemanticIntent patchIntent{};
  patchIntent.patchJson = R"({"schemaVersion":1,"seed":"semantic-patch"})";
  stackchan::TransitionSpec linearTransition{};
  linearTransition.paletteMs = 2000.0;
  linearTransition.parameterMs = 2000.0;
  linearTransition.modulationMs = 2000.0;
  linearTransition.topologyMs = 2000.0;
  linearTransition.easing = stackchan::TransitionEasing::Linear;
  const bool didApplyPatch = transitionRuntime.applyIntent(patchIntent, linearTransition);
  assert(didApplyPatch);
  assert(transitionRuntime.settings().scene == stackchan::SceneId::SemanticSynth);
  assert(transitionRuntime.settings().seed == "semantic-patch");
  assert(transitionRuntime.patchJson() == patchIntent.patchJson);
  transitionRuntime.update({}, 1.0F, 0);
  assert(transitionRuntime.variationTransitionActive());
  transitionRuntime.update({}, 1.0F, 0);
  assert(!transitionRuntime.variationTransitionActive());

  // Patch更新時に旧Patchを保持し、指定easingの進捗が遷移時間へ追従することを保証する。
  const std::string previousPatch = transitionRuntime.patchJson();
  stackchan::SemanticIntent nextPatchIntent{};
  nextPatchIntent.patchJson = minimalPatchJson("transition-next");
  assert(transitionRuntime.applyIntent(nextPatchIntent, linearTransition));
  assert(transitionRuntime.previousPatchJson() == previousPatch);
  assert(isNear(transitionRuntime.transitionProgress(), 0.0F, 0.000001F));
  transitionRuntime.update({}, 1.0F, 0);
  assert(isNear(transitionRuntime.transitionProgress(), 0.5F, 0.000001F));
  transitionRuntime.update({}, 1.0F, 0);
  assert(isNear(transitionRuntime.transitionProgress(), 1.0F, 0.000001F));

  // 同一TopologyのPatch変更ではtopologyMsを無視し、属性系の最長時間で完了することを保証する。
  stackchan::TransitionSpec sameTopologyTransition{};
  sameTopologyTransition.paletteMs = 300.0;
  sameTopologyTransition.parameterMs = 500.0;
  sameTopologyTransition.modulationMs = 400.0;
  sameTopologyTransition.topologyMs = 10000.0;
  sameTopologyTransition.easing = stackchan::TransitionEasing::Linear;
  stackchan::SemanticIntent sameTopologyIntent{};
  sameTopologyIntent.patchJson = minimalPatchJson("transition-same-topology");
  assert(transitionRuntime.applyIntent(sameTopologyIntent, sameTopologyTransition));
  assert(!transitionRuntime.patchTransitionProgress().usesDecks);
  transitionRuntime.update({}, 0.15F, 0);
  const auto attributeProgress = transitionRuntime.patchTransitionProgress();
  assert(isNear(attributeProgress.palette, 0.5F, 0.000001F));
  assert(isNear(attributeProgress.parameter, 0.3F, 0.000001F));
  assert(isNear(attributeProgress.modulation, 0.375F, 0.000001F));
  assert(isNear(attributeProgress.topology, 0.015F, 0.000001F));
  transitionRuntime.update({}, 0.35F, 0);
  assert(!transitionRuntime.variationTransitionActive());

  // seedが同一でもPatch属性が変われば遷移し、operator id変更はTopology変更になることを保証する。
  stackchan::RuntimeController sameSeedRuntime;
  stackchan::SemanticIntent sameSeedBase{};
  sameSeedBase.seed = "shared-transition-seed";
  sameSeedBase.patchJson = minimalPatchJson("shared-transition-seed");
  assert(sameSeedRuntime.applyIntent(sameSeedBase, linearTransition));
  sameSeedRuntime.update({}, 2.0F, 0);
  stackchan::SemanticIntent sameSeedChanged = sameSeedBase;
  sameSeedChanged.patchJson.replace(sameSeedChanged.patchJson.find("\"cells\":8"), 9,
                                    "\"cells\":12");
  assert(sameSeedRuntime.applyIntent(sameSeedChanged, linearTransition));
  assert(sameSeedRuntime.variationTransitionActive());
  assert(!sameSeedRuntime.patchTransitionProgress().usesDecks);
  sameSeedRuntime.update({}, 2.0F, 0);
  stackchan::SemanticIntent changedOperatorId = sameSeedChanged;
  changedOperatorId.patchJson.replace(changedOperatorId.patchJson.find("\"id\":\"src0\""), 11,
                                      "\"id\":\"src1\"");
  assert(sameSeedRuntime.applyIntent(changedOperatorId, linearTransition));
  assert(sameSeedRuntime.patchTransitionProgress().usesDecks);

  // Patch intentではJSON全体のhashではなくPatchが宣言したseedを採用することを保証する。
  stackchan::RuntimeController alternatePatchRuntime;
  stackchan::SemanticIntent alternatePatchIntent{};
  alternatePatchIntent.seed = "semantic-patch";
  alternatePatchIntent.patchJson =
      R"({"schemaVersion":1,"seed":"semantic-patch","operators":[{"id":"different"}]})";
  alternatePatchRuntime.applyIntent(alternatePatchIntent, linearTransition);
  alternatePatchRuntime.update({}, 2.0F, 0);
  assert(alternatePatchRuntime.settings().seed == "semantic-patch");
  assert(alternatePatchRuntime.variation().seed == "semantic-patch");

  // Semantic以外で変更したseedが、次にSemanticへ入るときのPatchへ反映されることを保証する。
  stackchan::RuntimeController deferredSeedRuntime;
  stackchan::Settings deferredSettings = deferredSeedRuntime.settings();
  deferredSettings.seed = "deferred-semantic-seed";
  deferredSeedRuntime.setSettings(deferredSettings);
  deferredSeedRuntime.shiftScene(-1);
  assert(deferredSeedRuntime.settings().scene == stackchan::SceneId::SemanticSynth);
  assert(stackchan::semanticPatchSeed(deferredSeedRuntime.patchJson()) ==
         std::optional<std::string>{"deferred-semantic-seed"});

  // 登録された11シーンすべてがCoreS3互換Canvasへ描画命令を発行することを保証する。
  stackchan::SceneRenderer sceneRenderer;
  for (std::size_t index = 0; index < stackchan::sceneCount(); ++index) {
    CountingCanvas canvas;
    const auto scene = stackchan::shiftedScene(stackchan::SceneId::Bars, static_cast<int>(index));
    sceneRenderer.draw(canvas, scene, analyzed, variation, 3.0F, 0.016F, 200.0F);
    assert(canvas.operations > 1);
  }

  // 10固定シーンそれぞれで4種類のvariantが異なる描画結果を持つことを保証する。
  for (std::size_t index = 0; index + 1U < stackchan::sceneCount(); ++index) {
    const auto scene = stackchan::shiftedScene(stackchan::SceneId::Bars, static_cast<int>(index));
    std::unordered_set<std::uint32_t> variantFingerprints;
    for (int variant = 0; variant < 4; ++variant) {
      stackchan::Variation variantVariation = variation;
      variantVariation.variant = variant;
      CountingCanvas variantCanvas;
      sceneRenderer.draw(variantCanvas, scene, analyzed, variantVariation, 3.0F, 0.016F, 200.0F);
      variantFingerprints.insert(variantCanvas.fingerprint);
    }
    assert(variantFingerprints.size() == 4U);
  }

  // 品質縮退が固定シーンの描画命令数を実際に削減することを保証する。
  CountingCanvas fullQualityCanvas;
  CountingCanvas reducedQualityCanvas(160, 120);
  sceneRenderer.draw(fullQualityCanvas, stackchan::SceneId::Fluid, analyzed, variation, 3.0F,
                     0.016F, 200.0F);
  sceneRenderer.draw(reducedQualityCanvas, stackchan::SceneId::Fluid, analyzed, variation, 3.0F,
                     0.016F, 200.0F);
  assert(reducedQualityCanvas.operations < fullQualityCanvas.operations);

  // 透過背景設定がホストCanvasのclear alphaまで伝播することを保証する。
  CountingCanvas transparentCanvas;
  sceneRenderer.draw(transparentCanvas, stackchan::SceneId::Bars, analyzed, variation, 3.0F, 0.016F,
                     200.0F, {}, nullptr, stackchan::Background::Transparent);
  assert(transparentCanvas.lastClearAlpha == 0);

  // 異なるSemantic PatchのOperator構成がCPU描画結果へ反映されることを保証する。
  CountingCanvas firstSemanticCanvas;
  CountingCanvas secondSemanticCanvas;
  sceneRenderer.draw(firstSemanticCanvas, stackchan::SceneId::SemanticSynth, analyzed, variation,
                     3.0F, 0.016F, 200.0F, stackchan::deriveSemanticPatchJson("portable-neon-042"));
  sceneRenderer.draw(secondSemanticCanvas, stackchan::SceneId::SemanticSynth, analyzed, variation,
                     3.0F, 0.016F, 200.0F,
                     stackchan::deriveSemanticPatchJson("different-operators-007"));
  assert(firstSemanticCanvas.fingerprint != secondSemanticCanvas.fingerprint);

  // 全Generatorがcatalog掲載だけで終わらず、CPU描画結果へ個別に影響することを保証する。
  std::unordered_set<std::uint32_t> generatorFingerprints;
  for (std::size_t index = 0; index < stackchan::kGeneratorDefinitionCount; ++index) {
    const std::string generatorPatch =
        std::string{"{\"schemaVersion\":1,\"seed\":\"catalog-coverage\",\"operators\":[{\"id\":"
                    "\"op0\",\"generatorId\":\""} +
        stackchan::kGeneratorDefinitions[index].id + "\",\"generatorVersion\":1}]}";
    CountingCanvas generatorCanvas;
    sceneRenderer.draw(generatorCanvas, stackchan::SceneId::SemanticSynth, analyzed, variation,
                       3.0F, 0.016F, 200.0F, generatorPatch);
    generatorFingerprints.insert(generatorCanvas.fingerprint);
  }
  assert(generatorFingerprints.size() == stackchan::kGeneratorDefinitionCount);

  // Semantic Patchのクロスフェード端点が旧Patchと新Patchの単独描画へ一致することを保証する。
  const std::string outgoingPatch = minimalPatchJson("transition-outgoing");
  const std::string incomingPatch = minimalPatchJson("transition-incoming");
  CountingCanvas directOutgoingCanvas;
  CountingCanvas transitionStartCanvas;
  CountingCanvas directIncomingCanvas;
  CountingCanvas transitionEndCanvas;
  sceneRenderer.draw(directOutgoingCanvas, stackchan::SceneId::SemanticSynth, analyzed, variation,
                     3.0F, 0.016F, 200.0F, outgoingPatch);
  sceneRenderer.draw(transitionStartCanvas, stackchan::SceneId::SemanticSynth, analyzed, variation,
                     3.0F, 0.016F, 200.0F, incomingPatch, nullptr, stackchan::Background::Black,
                     outgoingPatch, {1.0F, 1.0F, 1.0F, 0.0F, true});
  sceneRenderer.draw(directIncomingCanvas, stackchan::SceneId::SemanticSynth, analyzed, variation,
                     3.0F, 0.016F, 200.0F, incomingPatch);
  sceneRenderer.draw(transitionEndCanvas, stackchan::SceneId::SemanticSynth, analyzed, variation,
                     3.0F, 0.016F, 200.0F, incomingPatch, nullptr, stackchan::Background::Black,
                     outgoingPatch, {1.0F, 1.0F, 1.0F, 1.0F, true});
  assert(transitionStartCanvas.fingerprint == directOutgoingCanvas.fingerprint);
  assert(transitionEndCanvas.fingerprint == directIncomingCanvas.fingerprint);

  // 同一Topologyではpalette・parameter・modulationが互いの進行度に影響されず補間されることを保証する。
  const std::string attributeBasePatch = minimalPatchJson("attribute-base");
  std::string paletteTargetPatch = attributeBasePatch;
  paletteTargetPatch.replace(paletteTargetPatch.find("\"hueOffset\":200"), 15, "\"hueOffset\":20");
  CountingCanvas paletteBaseCanvas;
  CountingCanvas paletteStartCanvas;
  CountingCanvas paletteEndCanvas;
  sceneRenderer.draw(paletteBaseCanvas, stackchan::SceneId::SemanticSynth, analyzed, variation,
                     3.0F, 0.016F, 200.0F, attributeBasePatch);
  sceneRenderer.draw(paletteStartCanvas, stackchan::SceneId::SemanticSynth, analyzed, variation,
                     3.0F, 0.016F, 200.0F, paletteTargetPatch, nullptr,
                     stackchan::Background::Black, attributeBasePatch,
                     {0.0F, 1.0F, 1.0F, 1.0F, false});
  sceneRenderer.draw(paletteEndCanvas, stackchan::SceneId::SemanticSynth, analyzed, variation, 3.0F,
                     0.016F, 200.0F, paletteTargetPatch);
  assert(paletteStartCanvas.fingerprint == paletteBaseCanvas.fingerprint);
  assert(paletteEndCanvas.fingerprint != paletteBaseCanvas.fingerprint);

  std::string parameterTargetPatch = attributeBasePatch;
  parameterTargetPatch.replace(parameterTargetPatch.find("\"cells\":8"), 9, "\"cells\":16");
  CountingCanvas parameterStartCanvas;
  CountingCanvas parameterEndCanvas;
  sceneRenderer.draw(parameterStartCanvas, stackchan::SceneId::SemanticSynth, analyzed, variation,
                     3.0F, 0.016F, 200.0F, parameterTargetPatch, nullptr,
                     stackchan::Background::Black, attributeBasePatch,
                     {1.0F, 0.0F, 1.0F, 1.0F, false});
  sceneRenderer.draw(parameterEndCanvas, stackchan::SceneId::SemanticSynth, analyzed, variation,
                     3.0F, 0.016F, 200.0F, parameterTargetPatch);
  assert(parameterStartCanvas.fingerprint == paletteBaseCanvas.fingerprint);
  assert(parameterEndCanvas.fingerprint != paletteBaseCanvas.fingerprint);

  std::string discreteParameterBasePatch = attributeBasePatch;
  discreteParameterBasePatch.replace(discreteParameterBasePatch.find("\"cells\":8"), 9,
                                     "\"cells\":8,\"enabled\":false");
  std::string discreteParameterTargetPatch = discreteParameterBasePatch;
  discreteParameterTargetPatch.replace(discreteParameterTargetPatch.find("\"enabled\":false"), 15,
                                       "\"enabled\":true");
  CountingCanvas discreteParameterBaseCanvas;
  CountingCanvas discreteParameterStartCanvas;
  CountingCanvas discreteParameterEndCanvas;
  sceneRenderer.draw(discreteParameterBaseCanvas, stackchan::SceneId::SemanticSynth, analyzed,
                     variation, 3.0F, 0.016F, 200.0F, discreteParameterBasePatch);
  sceneRenderer.draw(discreteParameterStartCanvas, stackchan::SceneId::SemanticSynth, analyzed,
                     variation, 3.0F, 0.016F, 200.0F, discreteParameterTargetPatch, nullptr,
                     stackchan::Background::Black, discreteParameterBasePatch,
                     {1.0F, 0.0F, 1.0F, 1.0F, false});
  sceneRenderer.draw(discreteParameterEndCanvas, stackchan::SceneId::SemanticSynth, analyzed,
                     variation, 3.0F, 0.016F, 200.0F, discreteParameterTargetPatch);
  assert(discreteParameterStartCanvas.fingerprint == discreteParameterBaseCanvas.fingerprint);
  assert(discreteParameterEndCanvas.fingerprint != discreteParameterBaseCanvas.fingerprint);

  std::string paletteModeTargetPatch = attributeBasePatch;
  paletteModeTargetPatch.replace(paletteModeTargetPatch.find("\"mode\":\"mono\""), 13,
                                 "\"mode\":\"rainbow\"");
  CountingCanvas paletteModeStartCanvas;
  CountingCanvas paletteModeEndCanvas;
  sceneRenderer.draw(paletteModeStartCanvas, stackchan::SceneId::SemanticSynth, analyzed, variation,
                     3.0F, 0.016F, 200.0F, paletteModeTargetPatch, nullptr,
                     stackchan::Background::Black, attributeBasePatch,
                     {0.0F, 1.0F, 1.0F, 1.0F, false});
  sceneRenderer.draw(paletteModeEndCanvas, stackchan::SceneId::SemanticSynth, analyzed, variation,
                     3.0F, 0.016F, 200.0F, paletteModeTargetPatch);
  assert(paletteModeStartCanvas.fingerprint == paletteBaseCanvas.fingerprint);
  assert(paletteModeEndCanvas.fingerprint != paletteBaseCanvas.fingerprint);

  std::string modulationTargetPatch = attributeBasePatch;
  modulationTargetPatch.replace(
      modulationTargetPatch.find("\"routes\":[]"), 11,
      R"("routes":[{"source":"audio:bass","target":"src0.cells","amount":8,"polarity":"unipolar","smoothing":0}])");
  stackchan::AnalyzedAudioFrame transitionAudio = analyzed;
  transitionAudio.bass = 1.0F;
  CountingCanvas modulationBaseCanvas;
  CountingCanvas modulationStartCanvas;
  CountingCanvas modulationEndCanvas;
  sceneRenderer.draw(modulationBaseCanvas, stackchan::SceneId::SemanticSynth, transitionAudio,
                     variation, 3.0F, 1.0F, 200.0F, attributeBasePatch);
  sceneRenderer.draw(modulationStartCanvas, stackchan::SceneId::SemanticSynth, transitionAudio,
                     variation, 3.0F, 1.0F, 200.0F, modulationTargetPatch, nullptr,
                     stackchan::Background::Black, attributeBasePatch,
                     {1.0F, 1.0F, 0.0F, 1.0F, false});
  sceneRenderer.draw(modulationEndCanvas, stackchan::SceneId::SemanticSynth, transitionAudio,
                     variation, 3.0F, 1.0F, 200.0F, modulationTargetPatch);
  assert(modulationStartCanvas.fingerprint == modulationBaseCanvas.fingerprint);
  assert(modulationEndCanvas.fingerprint != modulationBaseCanvas.fingerprint);

  // 属性遷移中の再提案が直前の目標値へ跳ばず、現在描画中の中間状態から始まることを保証する。
  std::string firstRetargetPatch = attributeBasePatch;
  firstRetargetPatch.replace(firstRetargetPatch.find("\"hueOffset\":200"), 15, "\"hueOffset\":80");
  std::string secondRetargetPatch = attributeBasePatch;
  secondRetargetPatch.replace(secondRetargetPatch.find("\"hueOffset\":200"), 15,
                              "\"hueOffset\":320");
  CountingCanvas retargetBaseCanvas;
  CountingCanvas transitionMiddleCanvas;
  CountingCanvas retargetStartCanvas;
  sceneRenderer.draw(retargetBaseCanvas, stackchan::SceneId::SemanticSynth, analyzed, variation,
                     3.0F, 0.016F, 200.0F, attributeBasePatch);
  sceneRenderer.draw(transitionMiddleCanvas, stackchan::SceneId::SemanticSynth, analyzed, variation,
                     3.0F, 0.016F, 200.0F, firstRetargetPatch, nullptr,
                     stackchan::Background::Black, attributeBasePatch,
                     {0.4F, 0.4F, 0.4F, 1.0F, false});
  sceneRenderer.draw(retargetStartCanvas, stackchan::SceneId::SemanticSynth, analyzed, variation,
                     3.0F, 0.016F, 200.0F, secondRetargetPatch, nullptr,
                     stackchan::Background::Black, firstRetargetPatch,
                     {0.0F, 0.0F, 0.0F, 1.0F, false});
  assert(transitionMiddleCanvas.fingerprint == retargetStartCanvas.fingerprint);

  // routeのsource・amount・polarity・smoothingがCPU描画へ実際に反映されることを保証する。
  const std::string unmodulatedPatch = minimalPatchJson("route-test");
  std::string modulatedPatch = unmodulatedPatch;
  modulatedPatch.replace(
      modulatedPatch.find("\"routes\":[]"), 11,
      R"("routes":[{"source":"audio:bass","target":"src0.cells","amount":8,"polarity":"unipolar","smoothing":0}])");
  stackchan::AnalyzedAudioFrame routeAudio = analyzed;
  routeAudio.bass = 1.0F;
  CountingCanvas unmodulatedCanvas;
  CountingCanvas modulatedCanvas;
  sceneRenderer.draw(unmodulatedCanvas, stackchan::SceneId::SemanticSynth, routeAudio, variation,
                     3.0F, 1.0F, 200.0F, unmodulatedPatch);
  sceneRenderer.draw(modulatedCanvas, stackchan::SceneId::SemanticSynth, routeAudio, variation,
                     3.0F, 1.0F, 200.0F, modulatedPatch);
  assert(unmodulatedCanvas.fingerprint != modulatedCanvas.fingerprint);

  // Topologyクロスフェード中に旧・新デッキのmodulation平滑化状態が毎フレーム維持されることを保証する。
  std::string smoothedOutgoingPatch = minimalPatchJson("deck-outgoing");
  smoothedOutgoingPatch.replace(
      smoothedOutgoingPatch.find("\"routes\":[]"), 11,
      R"("routes":[{"source":"audio:bass","target":"src0.cells","amount":8,"polarity":"unipolar","smoothing":1}])");
  std::string differentTopologyPatch = minimalPatchJson("deck-incoming");
  differentTopologyPatch.replace(differentTopologyPatch.find("\"generatorId\":\"grid\""), 20,
                                 "\"generatorId\":\"points\"");
  stackchan::SceneRenderer topologyRenderer;
  CountingCanvas firstDeckFrame;
  CountingCanvas secondDeckFrame;
  topologyRenderer.draw(firstDeckFrame, stackchan::SceneId::SemanticSynth, routeAudio, variation,
                        3.0F, 1.0F, 200.0F, differentTopologyPatch, nullptr,
                        stackchan::Background::Black, smoothedOutgoingPatch,
                        {1.0F, 1.0F, 1.0F, 0.5F, true});
  topologyRenderer.draw(secondDeckFrame, stackchan::SceneId::SemanticSynth, routeAudio, variation,
                        3.0F, 1.0F, 200.0F, differentTopologyPatch, nullptr,
                        stackchan::Background::Black, smoothedOutgoingPatch,
                        {1.0F, 1.0F, 1.0F, 0.5F, true});
  assert(firstDeckFrame.fingerprint != secondDeckFrame.fingerprint);

  // base64画像をSHA-256で登録し、stamp PatchがCanvasの画像描画を呼ぶことを保証する。
  stackchan::ImageStore imageStore;
  const auto imageResult = imageStore.putBase64("pixel.png",
                                                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0"
                                                "lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
                                                "image/png");
  assert(imageResult.ok);
  assert(imageResult.asset != nullptr);
  assert(imageResult.asset->hash ==
         "431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460");

  // 64 KiB未満の複数リクエストへ分割しても、単発送信と同じ画像になることを保証する。
  stackchan::ImageStore chunkedImageStore;
  const auto beganImage = chunkedImageStore.beginBase64("pixel.png", "image/png", 68);
  assert(beganImage.ok);
  assert(chunkedImageStore.uploadActive());
  assert(chunkedImageStore.appendBase64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwC").ok);
  assert(chunkedImageStore.appendBase64("AAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=").ok);
  const auto committedImage = chunkedImageStore.commitBase64();
  assert(committedImage.ok);
  assert(committedImage.asset != nullptr);
  assert(committedImage.asset->hash == imageResult.asset->hash);
  assert(!chunkedImageStore.uploadActive());

  // 不正chunkで転送状態を破棄し、次の画像転送を再起動できることを保証する。
  assert(chunkedImageStore.beginBase64("broken.png", "image/png", 3).ok);
  assert(!chunkedImageStore.appendBase64("not-base64").ok);
  assert(!chunkedImageStore.uploadActive());
  assert(chunkedImageStore.beginBase64("retry.png", "image/png", 68).ok);
  chunkedImageStore.cancelBase64();

  // SD復元用の生バイト登録が同じhashを再検証し、永続化後にRAMを解放することを保証する。
  stackchan::ImageStore restoredImageStore;
  const auto restoredImage = restoredImageStore.putBytes("restored.png", imageResult.asset->bytes,
                                                         imageResult.asset->mime);
  assert(restoredImage.ok);
  assert(restoredImage.asset != nullptr);
  assert(restoredImage.asset->hash == imageResult.asset->hash);
  assert(restoredImageStore.markPersisted(restoredImage.asset->hash, "/vj-images/restored.png"));
  assert(restoredImageStore.latest()->bytes.empty());
  assert(restoredImageStore.latest()->storagePath == "/vj-images/restored.png");

  // 5 MiB上限の画像でもSHA-256計算用の全体コピーを作らず登録できることを保証する。
  std::vector<std::uint8_t> maximumImageBytes(std::size_t{5} * 1024U * 1024U, 0U);
  constexpr std::array<std::uint8_t, 8> pngSignature = {0x89U, 0x50U, 0x4EU, 0x47U,
                                                        0x0DU, 0x0AU, 0x1AU, 0x0AU};
  std::copy(pngSignature.begin(), pngSignature.end(), maximumImageBytes.begin());
  stackchan::ImageStore maximumImageStore;
  const auto maximumImage =
      maximumImageStore.putBytes("maximum.png", std::move(maximumImageBytes), "image/png");
  assert(maximumImage.ok);
  assert(maximumImage.asset != nullptr);
  assert(maximumImage.asset->hash ==
         "a3f8fb5b0c161cebf9bd46ee1fbe1b1413fb83f789ebc25303534be8e8b3b080");
  assert(maximumImageStore.markPersisted(maximumImage.asset->hash, "/vj-images/maximum.png"));

  // 拡張子や申告MIMEだけではなく実バイトのsignatureを検証することを保証する。
  const auto wrongMimeImage =
      chunkedImageStore.putBase64("pixel.jpg",
                                  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0"
                                  "lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
                                  "image/jpeg");
  assert(!wrongMimeImage.ok);
  assert(wrongMimeImage.issue.find("MIME") != std::string::npos);
  const std::string imagePatch =
      R"({"schemaVersion":1,"seed":"image-patch","operators":[{"id":"src0","generatorId":"stamp","generatorVersion":1,"parameters":{"fit":"contain","scale":1,"invert":false}},{"id":"mod0","generatorId":"spin","generatorVersion":1,"parameters":{"rate":0.4,"wobble":0.2}},{"id":"mat0","generatorId":"neon","generatorVersion":1,"parameters":{"hue":200,"intensity":1.2}}],"routes":[],"palette":{"mode":"mono","hueOffset":200,"saturation":80,"lightness":55},"composition":{"symmetry":4,"scale":1,"speed":1},"qualityTier":"medium","images":{"src0.image":{"name":"pixel.png","hash":"431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460"}}})";
  CountingCanvas imageCanvas;
  sceneRenderer.draw(imageCanvas, stackchan::SceneId::SemanticSynth, analyzed, variation, 3.0F,
                     0.016F, 200.0F, imagePatch, &imageStore);
  assert(imageCanvas.imageOperations == 1);

  // 複数stamp Operatorの画像参照を最初の1件に縮退させず、すべて描画することを保証する。
  const std::string secondImagePatch =
      R"({"schemaVersion":1,"seed":"two-images","operators":[{"id":"src0","generatorId":"stamp","generatorVersion":1,"parameters":{"fit":"contain","scale":1,"invert":false}},{"id":"src1","generatorId":"stamp","generatorVersion":1,"parameters":{"fit":"cover","scale":1,"invert":false}},{"id":"mat0","generatorId":"neon","generatorVersion":1,"parameters":{"hue":200,"intensity":1.2}}],"routes":[],"palette":{"mode":"mono","hueOffset":200,"saturation":80,"lightness":55},"composition":{"symmetry":4,"scale":1,"speed":1},"qualityTier":"medium","images":{"src0.image":{"name":"pixel-a.png","hash":"431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460"},"src1.image":{"name":"pixel-b.png","hash":"431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460"}}})";
  CountingCanvas multipleImageCanvas;
  sceneRenderer.draw(multipleImageCanvas, stackchan::SceneId::SemanticSynth, analyzed, variation,
                     3.0F, 0.016F, 200.0F, secondImagePatch, &imageStore);
  assert(multipleImageCanvas.imageOperations == 2);

  // 秒・小節・外部トリガーのTimelineイベントが一度だけ順序通り発火することを保証する。
  stackchan::VisualEvent secondsEvent{};
  secondsEvent.id = "seconds";
  secondsEvent.start = {stackchan::AnchorKind::Seconds, 2.0, {}};
  secondsEvent.intent.seed = "acid-koi-001";
  stackchan::VisualEvent barEvent{};
  barEvent.id = "bar";
  barEvent.start = {stackchan::AnchorKind::Bar, 4.0, {}};
  stackchan::VisualEvent externalEvent{};
  externalEvent.id = "external";
  externalEvent.start = {stackchan::AnchorKind::External, 0.0, "drop"};
  stackchan::PerformanceTimeline timeline{};
  timeline.events = {barEvent, secondsEvent, externalEvent};
  stackchan::SchedulerState scheduler{};
  stackchan::TimeContext timeContext{3.0, 4, 0.0F, 120.0F, true};
  const auto dueEvents = stackchan::collectDueEvents(timeline, scheduler, timeContext);
  assert(dueEvents.size() == 2);
  assert(dueEvents[0].event.id == "seconds");
  assert(dueEvents[1].event.id == "bar");
  assert(stackchan::collectDueEvents(timeline, scheduler, timeContext).empty());
  const auto externalEvents =
      stackchan::fireExternalEvents(timeline, scheduler, "drop", timeContext);
  assert(externalEvents.size() == 1);

  // lockedイベントとlockedUntilSec以前への変更が拒否され、元Timelineを維持することを保証する。
  timeline.lockedUntilSec = 5.0;
  timeline.events[0].locked = true;
  stackchan::TimelineOp removeLocked{};
  removeLocked.kind = stackchan::TimelineOpKind::Remove;
  removeLocked.id = "bar";
  const auto lockedResult = stackchan::applyTimelineOp(timeline, removeLocked, timeContext);
  assert(!lockedResult.ok);
  assert(lockedResult.timeline.events.size() == timeline.events.size());

  // USB Serial用JSONがBridge互換メソッドとUnicode seedを安全に解釈することを保証する。
  const auto stateRequest = stackchan::parseControlRequest(R"({"id":1,"method":"getState"})");
  assert(stateRequest.ok);
  assert(stateRequest.id == 1);
  assert(stateRequest.method == stackchan::ControlMethod::GetState);
  const auto seedRequest = stackchan::parseControlRequest(
      R"({"id":2,"method":"proposeSeed","params":{"seed":"日本語🎛️"}})");
  assert(seedRequest.ok);
  assert(seedRequest.text == "日本語🎛️");
  const auto escapedSeedRequest = stackchan::parseControlRequest(
      R"({"id":3,"method":"proposeSeed","params":{"seed":"\u65e5\u672c\ud83c\udf9b"}})");
  assert(escapedSeedRequest.ok);
  assert(escapedSeedRequest.text == "日本🎛");
  const auto invalidDelta =
      stackchan::parseControlRequest(R"({"id":4,"method":"shiftScene","params":{"delta":1.5}})");
  assert(!invalidDelta.ok);
  const auto invalidFactor =
      stackchan::parseControlRequest(R"({"id":5,"method":"tempoMultiply","params":{"factor":3}})");
  assert(!invalidFactor.ok);
  const auto invalidRequest = stackchan::parseControlRequest(R"({"id":-1,"method":"getState"})");
  assert(!invalidRequest.ok);
  const auto catalogRequest = stackchan::parseControlRequest(R"({"id":13,"method":"getCatalog"})");
  assert(catalogRequest.ok);
  assert(catalogRequest.method == stackchan::ControlMethod::GetCatalog);
  const auto beginImageRequest = stackchan::parseControlRequest(
      R"({"id":16,"method":"beginImageUpload","params":{"name":"pixel.png","mime":"image/png","byteLength":68}})");
  assert(beginImageRequest.ok);
  assert(beginImageRequest.method == stackchan::ControlMethod::BeginImageUpload);
  const auto appendImageRequest = stackchan::parseControlRequest(
      R"({"id":17,"method":"appendImageUpload","params":{"bytesBase64":"iVBORw0K"}})");
  assert(appendImageRequest.ok);
  assert(appendImageRequest.method == stackchan::ControlMethod::AppendImageUpload);

  // 既存vj-ctlが送る入れ子JSONをTimelineOpへ変換し、patch JSONも欠落させないことを保証する。
  const std::string timelineJson =
      R"({"id":6,"method":"applyTimelineOp","params":{"op":{"op":"add","event":{"id":"ctl-1","start":{"kind":"external","id":"drop"},"duration":{"kind":"untilNext"},"intent":{"seed":"rainy-qilou","patch":)" +
      minimalPatchJson("patch-seed") +
      R"(},"transition":{"paletteMs":1200,"parameterMs":800,"modulationMs":1000,"topologyMs":2000,"easing":"easeInOut"},"confidence":1,"locked":false}}}})";
  const auto timelineRequest = stackchan::parseControlRequest(timelineJson);
  assert(timelineRequest.ok);
  assert(timelineRequest.method == stackchan::ControlMethod::ApplyTimelineOp);
  assert(timelineRequest.timelineOperation.kind == stackchan::TimelineOpKind::Add);
  assert(timelineRequest.timelineOperation.event.start.kind == stackchan::AnchorKind::External);
  assert(timelineRequest.timelineOperation.event.intent.seed == "patch-seed");
  assert(timelineRequest.timelineOperation.event.intent.patchJson.find("patch-seed") !=
         std::string::npos);
  const std::string patchJson = R"({"id":7,"method":"proposePatch","params":{"patch":)" +
                                minimalPatchJson("direct-patch") + "}}";
  const auto patchRequest = stackchan::parseControlRequest(patchJson);
  assert(patchRequest.ok);
  assert(patchRequest.method == stackchan::ControlMethod::ProposePatch);
  assert(patchRequest.intent.seed == "direct-patch");
  assert(patchRequest.intent.patchJson.find("operators") != std::string::npos);
  std::string unknownGeneratorPatch = minimalPatchJson("invalid-patch");
  unknownGeneratorPatch.replace(unknownGeneratorPatch.find("\"grid\""), 6, "\"unknown-generator\"");
  const std::string invalidPatchJson =
      R"({"id":14,"method":"proposePatch","params":{"patch":)" + unknownGeneratorPatch + "}}";
  const auto invalidPatchRequest = stackchan::parseControlRequest(invalidPatchJson);
  assert(!invalidPatchRequest.ok);
  assert(invalidPatchRequest.issue.find("not found in catalog") != std::string::npos);
  std::string outOfRangePatch = minimalPatchJson("invalid-range");
  outOfRangePatch.replace(outOfRangePatch.find("\"cells\":8"), 9, "\"cells\":128");
  const auto outOfRangeRequest = stackchan::parseControlRequest(
      R"({"id":15,"method":"proposePatch","params":{"patch":)" + outOfRangePatch + "}}");
  assert(!outOfRangeRequest.ok);
  assert(outOfRangeRequest.issue.find("outside its range") != std::string::npos);
  const auto fireRequest =
      stackchan::parseControlRequest(R"({"id":8,"method":"fireExternal","params":{"id":"drop"}})");
  assert(fireRequest.ok);
  assert(fireRequest.text == "drop");

  // ホストとCoreS3が同じControlServiceでTimeline登録・外部発火・Patch適用することを保証する。
  stackchan::AudioAnalyzer controlAnalyzer;
  stackchan::RuntimeController controlRuntime;
  stackchan::ControlService controlService(controlRuntime, controlAnalyzer);
  const auto addResult = controlService.dispatch(timelineRequest, analyzed, 3500, 42);
  assert(addResult.response.find("\"ok\":true") != std::string::npos);
  assert(controlService.timeline().events.size() == 1);
  const auto fireResult = controlService.dispatch(fireRequest, analyzed, 3600, 43);
  assert(fireResult.settingsChanged);
  assert(controlRuntime.settings().scene == stackchan::SceneId::SemanticSynth);
  assert(controlRuntime.settings().seed == "patch-seed");
  assert(controlRuntime.patchJson().find("patch-seed") != std::string::npos);
  const auto directPatchResult = controlService.dispatch(patchRequest, analyzed, 3700, 44);
  assert(directPatchResult.settingsChanged);
  assert(controlRuntime.settings().seed == "direct-patch");
  const auto invalidPatchResult = controlService.dispatch(invalidPatchRequest, analyzed, 3750, 45);
  assert(invalidPatchResult.response.find("\"ok\":false") != std::string::npos);
  assert(invalidPatchResult.response.find("\"issues\":[") != std::string::npos);
  controlRuntime.update({}, 2.0F, 0);
  assert(controlRuntime.variation().seed == "direct-patch");

  // 録画開始からTimeline操作の記録・停止までを既存vj-ctlの応答形式で保持することを保証する。
  const auto startRecordingRequest =
      stackchan::parseControlRequest(R"({"id":9,"method":"startRecording"})");
  assert(startRecordingRequest.ok);
  const auto startRecordingResult =
      controlService.dispatch(startRecordingRequest, analyzed, 3800, 45);
  assert(startRecordingResult.response.find("\"ok\":true") != std::string::npos);
  assert(controlService.recordingActive());
  const auto recordedOperationRequest = stackchan::parseControlRequest(
      R"({"id":10,"method":"applyTimelineOp","params":{"op":{"op":"setLockedUntil","sec":12}}})");
  const auto recordedOperationResult =
      controlService.dispatch(recordedOperationRequest, analyzed, 3900, 46);
  assert(recordedOperationResult.response.find("\"ok\":true") != std::string::npos);
  const auto stopRecordingRequest =
      stackchan::parseControlRequest(R"({"id":11,"method":"stopRecording"})");
  const auto stopRecordingResult =
      controlService.dispatch(stopRecordingRequest, analyzed, 4000, 47);
  assert(!controlService.recordingActive());
  assert(stopRecordingResult.response.find("stackchan-core-1") != std::string::npos);
  assert(stopRecordingResult.response.find("setLockedUntil") != std::string::npos);

  // ブラウザ互換recordingからTimelineと初期Patchを復元することを保証する。
  const std::string loadEvent =
      R"({"id":"loaded-event","start":{"kind":"seconds","atSec":20},"duration":{"kind":"untilNext"},"intent":{"seed":"loaded-seed"},"transition":{"paletteMs":1200,"parameterMs":800,"modulationMs":1000,"topologyMs":2000,"easing":"easeInOut"},"confidence":1,"locked":false})";
  const std::string recordingJson =
      R"({"schemaVersion":1,"engineVersion":"web-1","sessionSeed":"record-seed","initialPatch":)" +
      minimalPatchJson("record-seed") + R"(,"ops":[{"atSec":0,"op":{"op":"add","event":)" +
      loadEvent + R"(}}],"fired":[]})";
  const std::string loadRequestJson = R"({"id":12,"method":"loadRecording","params":{"json":)" +
                                      quoteJsonString(recordingJson) + "}}";
  const auto loadRequest = stackchan::parseControlRequest(loadRequestJson);
  assert(loadRequest.ok);
  const auto loadResult = controlService.dispatch(loadRequest, analyzed, 4100, 48);
  assert(loadResult.settingsChanged);
  assert(loadResult.response.find("\"ok\":true") != std::string::npos);
  assert(controlService.timeline().events.size() == 1);
  assert(controlService.timeline().events[0].id == "loaded-event");
  assert(controlRuntime.patchJson().find("record-seed") != std::string::npos);

  // TypeScriptの正本から生成した全Generatorカタログを既存CLI形式で返すことを保証する。
  const auto catalogResult = controlService.dispatch(catalogRequest, analyzed, 4200, 49);
  assert(catalogResult.response.find("\"id\":13") != std::string::npos);
  assert(catalogResult.response.find("\"id\":\"grid\"") != std::string::npos);
  assert(catalogResult.response.find("\"id\":\"stamp\"") != std::string::npos);
  assert(catalogResult.response.find("\"textures\":[\"image\"]") != std::string::npos);

  // 状態応答が既存CLIで扱えるid/result形式とテンポ・遷移状態を保持することを保証する。
  stackchan::TempoState controlTempo{};
  controlTempo.bpm = 120.0F;
  controlTempo.locked = true;
  const stackchan::ControlSnapshot controlSnapshot{&runtime.settings(),
                                                   &controlTempo,
                                                   &timeline,
                                                   &scheduler,
                                                   &runtime.patchJson(),
                                                   0.75F,
                                                   true,
                                                   false,
                                                   3.5};
  const std::string stateResponse = stackchan::encodeControlState(7, controlSnapshot);
  assert(stateResponse.find("\"id\":7") != std::string::npos);
  assert(stateResponse.find("\"bpm\":120.000") != std::string::npos);
  assert(stateResponse.find("\"transitionActive\":true") != std::string::npos);
  assert(stateResponse.find("\"qualityScale\":0.750") != std::string::npos);
  assert(stateResponse.find("\"timeline\":") != std::string::npos);
  assert(stateResponse.find("\"firedIds\":[\"seconds\",\"bar\",\"external\"]") !=
         std::string::npos);
  return 0;
}
