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
  const auto invalidRequest = stackchan::parseControlRequest(R"({"id":-1,"method":"getState"})");
  assert(!invalidRequest.ok);

  // 状態応答が既存CLIで扱えるid/result形式とテンポ・遷移状態を保持することを保証する。
  stackchan::TempoState controlTempo{};
  controlTempo.bpm = 120.0F;
  controlTempo.locked = true;
  const stackchan::ControlSnapshot controlSnapshot{&runtime.settings(), &controlTempo, true, 3.5};
  const std::string stateResponse = stackchan::encodeControlState(7, controlSnapshot);
  assert(stateResponse.find("\"id\":7") != std::string::npos);
  assert(stateResponse.find("\"bpm\":120.000") != std::string::npos);
  assert(stateResponse.find("\"transitionActive\":true") != std::string::npos);
  return 0;
}
