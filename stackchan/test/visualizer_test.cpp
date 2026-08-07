#include "visualizer/visualizer.hpp"

#include <cassert>

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
  return 0;
}
