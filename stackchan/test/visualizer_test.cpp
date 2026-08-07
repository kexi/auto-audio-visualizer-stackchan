#include "visualizer/audio.hpp"
#include "visualizer/control.hpp"
#include "visualizer/runtime.hpp"
#include "visualizer/scene_renderer.hpp"
#include "visualizer/settings.hpp"
#include "visualizer/timeline.hpp"
#include "visualizer/variation.hpp"
#include "visualizer/visualizer.hpp"

#include <array>
#include <cassert>
#include <cmath>

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
  [[nodiscard]] int width() const override { return 320; }
  [[nodiscard]] int height() const override { return 240; }
  void clear(stackchan::Color) override { ++operations; }
  void line(int, int, int, int, stackchan::Color, int) override { ++operations; }
  void rectangle(int, int, int, int, stackchan::Color, bool) override { ++operations; }
  void circle(int, int, int, stackchan::Color, bool) override { ++operations; }
  void text(int, int, const std::string&, stackchan::Color) override { ++operations; }

  int operations = 0;
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

  // 500ms間隔のタップが120 BPMの手動グリッドを生成することを保証する。
  stackchan::TempoTracker tempo;
  tempo.update(0.0F, 0.0F, 1000);
  tempo.tap(1000);
  tempo.tap(1500);
  tempo.update(0.0F, 0.0F, 1500);
  assert(tempo.state().mode == stackchan::TempoMode::Manual);
  assert(isNear(tempo.state().bpm, 120.0F, 0.01F));
  tempo.multiply(2.0F);
  assert(isNear(tempo.state().bpm, 240.0F, 0.01F));
  tempo.setAuto();
  assert(tempo.state().mode == stackchan::TempoMode::Auto);

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

  // 1サンプルの入力でもスペクトル値がNaNにならないことを保証する。
  const std::int16_t singleSample = 1200;
  const auto singleAnalyzed = analyzer.process(&singleSample, 1, 16000, 1.5F, 2010);
  for (const float bin : singleAnalyzed.spectrum) {
    assert(std::isfinite(bin));
  }

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
  assert(transitionRuntime.settings().seed.rfind("patch-", 0) == 0);
  assert(transitionRuntime.patchJson() == patchIntent.patchJson);
  transitionRuntime.update({}, 1.0F, 0);
  assert(transitionRuntime.variationTransitionActive());
  transitionRuntime.update({}, 1.0F, 0);
  assert(!transitionRuntime.variationTransitionActive());

  // 同じPatch seedでもoperator JSONが異なればCPU表現が変わることを保証する。
  stackchan::RuntimeController alternatePatchRuntime;
  stackchan::SemanticIntent alternatePatchIntent{};
  alternatePatchIntent.seed = "semantic-patch";
  alternatePatchIntent.patchJson =
      R"({"schemaVersion":1,"seed":"semantic-patch","operators":[{"id":"different"}]})";
  alternatePatchRuntime.applyIntent(alternatePatchIntent, linearTransition);
  alternatePatchRuntime.update({}, 2.0F, 0);
  assert(alternatePatchRuntime.variation().seed != transitionRuntime.variation().seed);

  // 登録された11シーンすべてがCoreS3互換Canvasへ描画命令を発行することを保証する。
  stackchan::SceneRenderer sceneRenderer;
  for (std::size_t index = 0; index < stackchan::sceneCount(); ++index) {
    CountingCanvas canvas;
    const auto scene = stackchan::shiftedScene(stackchan::SceneId::Bars, static_cast<int>(index));
    sceneRenderer.draw(canvas, scene, analyzed, variation, 3.0F, 0.016F, 200.0F);
    assert(canvas.operations > 1);
  }

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
  assert(timelineRequest.timelineOperation.event.intent.seed == "rainy-qilou");
  assert(timelineRequest.timelineOperation.event.intent.patchJson.find("patch-seed") !=
         std::string::npos);
  const std::string patchJson = R"({"id":7,"method":"proposePatch","params":{"patch":)" +
                                minimalPatchJson("direct-patch") + "}}";
  const auto patchRequest = stackchan::parseControlRequest(patchJson);
  assert(patchRequest.ok);
  assert(patchRequest.method == stackchan::ControlMethod::ProposePatch);
  assert(patchRequest.intent.seed == "direct-patch");
  assert(patchRequest.intent.patchJson.find("operators") != std::string::npos);
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
  assert(controlRuntime.settings().seed == "rainy-qilou");
  assert(controlRuntime.patchJson().find("patch-seed") != std::string::npos);
  const auto directPatchResult = controlService.dispatch(patchRequest, analyzed, 3700, 44);
  assert(directPatchResult.settingsChanged);
  assert(controlRuntime.settings().seed == "direct-patch");
  controlRuntime.update({}, 2.0F, 0);
  assert(controlRuntime.variation().seed.rfind("patch-", 0) == 0);

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

  // 状態応答が既存CLIで扱えるid/result形式とテンポ・遷移状態を保持することを保証する。
  stackchan::TempoState controlTempo{};
  controlTempo.bpm = 120.0F;
  controlTempo.locked = true;
  const stackchan::ControlSnapshot controlSnapshot{
      &runtime.settings(),  &controlTempo, &timeline, &scheduler,
      &runtime.patchJson(), true,          false,     3.5};
  const std::string stateResponse = stackchan::encodeControlState(7, controlSnapshot);
  assert(stateResponse.find("\"id\":7") != std::string::npos);
  assert(stateResponse.find("\"bpm\":120.000") != std::string::npos);
  assert(stateResponse.find("\"transitionActive\":true") != std::string::npos);
  assert(stateResponse.find("\"timeline\":") != std::string::npos);
  assert(stateResponse.find("\"firedIds\":[\"seconds\",\"bar\",\"external\"]") !=
         std::string::npos);
  return 0;
}
