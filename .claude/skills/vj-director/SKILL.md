---
name: vj-director
description: VJ ツールの semantic-synth を外部から操縦する。「映像を〜な感じに」「N小節後に切り替えて」等の依頼で使う
---

# vj-director

ブラウザで動いている **Semantic Synth** シーンを、WebSocket 中継 (`scripts/vj-bridge.mjs`) 越しに
CLI (`scripts/vj-ctl.mjs`) から操縦する。叩いているのは `src/synth/control.ts` の
`getSynthControl()` — UI パネルと同じ制御サーフェスなので、ここから出した指示は
画面上の操作とまったく同じ経路を通る（検証ゲートも同じように効く）。

映像を「いま」変えるだけでなく、**Timeline に予約する**（N 秒後 / N 小節後）ことができる。
本番中に人間の手を止めずに次の展開を仕込めるのがこの経路の主目的。

## 使う前に（3 ステップ）

1. **中継を起動する**（バックグラウンドで動かしっぱなしにする）

   ```bash
   pnpm bridge          # = node scripts/vj-bridge.mjs、127.0.0.1:7877 で待ち受ける
   ```

   `vj-bridge listening on ws://127.0.0.1:7877 ...` の 1 行が出れば OK。
   127.0.0.1 にしかバインドしないので LAN には出ない（無認証なので出してはいけない）。

2. **ユーザーにアプリを開いてもらう** — URL に `bridge=1` が要る。

   ```
   https://localhost:5173/?scene=semantic-synth&bridge=1
   ```

   ポートは `pnpm dev` の出力に従う。自己署名証明書なのでブラウザに警告が出ますが、詳細設定からアクセスを許可してください。`bridge=1` が無いとブラウザ側は中継に接続しないので、
   「シーンは映っているのに `no synth connected`」になる。ここは**ユーザーに頼む**必要がある
   （こちらからブラウザは開けない）。

3. **疎通確認**

   ```bash
   node scripts/vj-ctl.mjs state
   ```

   - JSON が返る → 準備完了
   - `{"error":"no synth connected"}` → 2 のタブが開いていない / `bridge=1` が付いていない
   - `{"error":"timeout after 20s"}` や `ECONNREFUSED` → 1 の bridge が起動していない

## コマンド

すべて `node scripts/vj-ctl.mjs <command>`。共通オプションは `--port <n>`（既定 7877）と `--help`。

| コマンド | 何をするか |
|---|---|
| `state` | 現在の Patch / Timeline / nowSec / barCount などを表示 |
| `catalog` | Generator の一覧（id・category・tags・parameters・cost）を表示 |
| `seed <seed>` | seed から派生した Patch へ**いま**遷移（ガチャ） |
| `patch <file.json>` | VisualPatch を**いま**適用 |
| `event add ...` | 「N 秒後 / N 小節後に切り替える」を Timeline に予約 |
| `event remove <id>` | 予約を取り消す |
| `lock <sec>` | **今から N 秒間** Timeline をロック（この間の変更を拒否する） |
| `fire <externalId>` | `external` anchor のイベントを手で発火 |
| `record start` / `record stop` | 演出の記録開始 / 停止して JSON を吐く |
| `load <recording.json>` | 記録した演出を読み込んで再現 |

```bash
# 現在の状態を見る
node scripts/vj-ctl.mjs state

# カタログから Generator と tags を眺める
node scripts/vj-ctl.mjs catalog

# いますぐ雰囲気を変える（seed ガチャ）
node scripts/vj-ctl.mjs seed "humid-night-market"

# いますぐ狙った Patch を当てる
node scripts/vj-ctl.mjs patch /tmp/patch.json

# 30 秒後に seed を切り替える（ゆっくり遷移）
node scripts/vj-ctl.mjs event add --in 30 --seed rainy-qilou --transition slow

# 8 小節後に Patch を差し替える（テンポがロックされているときだけ発火する）
node scripts/vj-ctl.mjs event add --bar 8 --patch /tmp/next.json --label "chorus"

# 予約を取り消す（id は event add の出力に入っている）
node scripts/vj-ctl.mjs event remove ctl-1785957182217

# 今から 60 秒間は誰にも触らせない（MC 中・決めの画など）
node scripts/vj-ctl.mjs lock 60

# external anchor のイベントを手で発火
node scripts/vj-ctl.mjs fire drop

# 演出を記録して保存 → 後で再現
node scripts/vj-ctl.mjs record start
node scripts/vj-ctl.mjs record stop > recording.json
node scripts/vj-ctl.mjs load recording.json
```

`event add` のオプション:

- `--in <sec>` … 今から N 秒後（`start = {kind:'seconds', atSec: nowSec + sec}`）
- `--bar <n>` … 今から N 小節後（`start = {kind:'bar', bar: floor(barCount) + n}`）。`--bar` があればこちらが優先。
  テンポがロックされていない（`state.tempoLocked === false`）と bar anchor は発火しないので、その場合は `--in` を使う。
- `--seed <s>` / `--patch <file>` / `--label <s>` … intent。最低ひとつ要る（全部無いとエラー）。
- `--transition default | slow | cut` … 既定は `default`。`slow` は default の 2 倍かけて溶ける。`cut` は 120ms で切り替わる。

`--in` / `--bar` / `lock <sec>` はすべて**相対指定**。CLI が `state` を引いて絶対値に直してから送るので、
「今から 30 秒後」「今から 60 秒ロック」とそのまま書けばよい。

## 出力の読み方

- **exit 0** … 成功。stdout に結果 JSON（整形済み）。
- **exit 1 かつ `{"ok":false, "issues":[...]}` / `{"ok":false,"issue":"..."}`**
  … 通信は成功したが**提案が却下された**。issues を読んで直して投げ直す。
- **exit 1 かつ `{"error":"..."}`** … 通信または引数のエラー。stderr に対処のヒントが出る。
- `record stop` だけは例外で、recording の JSON を**再整形せずそのまま** stdout に出す。
  そのまま `> recording.json` して `load` に食わせられる。

## ムードを実装に翻訳する

依頼はたいてい「もっと湿った感じ」「懐かしい方向で」のような形容詞で来る。手順:

1. **`catalog` でタグを眺める。** 各 Generator には 5 軸のタグが付いている
   （`environment` / `culturalTexture` / `material` / `motion` / `affect`）。
   形容詞は主に **`affect`** と **`culturalTexture`** に対応する。
2. **`state` で現在の Patch を取る。** `currentPatch` をベースにする。ゼロから組むより、
   いま出ているものの operators を差し替える方が事故が少ない。
3. **operators を差し替えた Patch JSON を作る**（ステージ順・員数制限は下記）。
4. **`patch <file.json>` で適用。** 検証ゲートに落ちたら `issues` が返るので、それを見て直す。

### 実在するタグ → Generator の対応（`catalog` で確認できるもの）

| 依頼の言葉 | 引くタグ | 候補 Generator |
|---|---|---|
| 湿った・蒸し暑い・雨上がり | `affect: humid / wet` `material: wet-concrete` | `humidityLens`(field) `nightMarketCurtain`(source) `sway`(field) `wetConcrete`(material) `brakeLightRain`(material) |
| 懐かしい・昔の映像・color fade | `affect: nostalgic / 2000s / faded / analog` `culturalTexture: retro / broadcast / lo-fi` | `minidvFade` `crt` `fluorescent` `cheapLed` `misprint` `pixelate` `tapeWow`(field) |
| 台湾の街・環島・下町 | `culturalTexture: taiwan-streetscape / sinosphere` | `qilouShutter` `busJacquard` `grille` `brakeLightRain` `templeZigzag` `roadStitch` |
| 夜・街灯・湿った夜道 | `environment: urban-night` `affect: nocturnal` `material: sodium-vapor` | `sodium` `brakeLightRain` `nightMarketCurtain` `humidityLens` |
| 攻めた・不穏・壊れた | `affect: ominous / tense / broken / chaotic / unstable / eerie` `motion: glitch` | `typhoonShear`(field) `dropout`(modifier) `slice`(modifier) `noise`(field) `tapeWow`(field) |
| 静か・淡々・瞑想的 | `affect: meditative / quiet / slow / sparse / restrained / persistent` | `roadStitch` `mooringRope` `ink`(material) `points` `viaductJoints` `qilouShutter` |
| 硬い・インフラ・都市の骨格 | `affect: infrastructural / brutalist / heavy / metropolitan` `environment: urban / architectural` | `flyoverBeams` `viaductJoints` `grid` `wires` `tiles` |
| 派手・祝祭・電飾 | `affect: festive / ornate / electric / kitsch` `culturalTexture: signage / cyber` | `templeZigzag` `neon` `cheapLed` `busJacquard` |
| 生活・所帯じみた・コンビニ | `environment: domestic / late-night-store / interior` `affect: mundane / sterile / tropical` | `fanGuard` `freezerCyan` `fluorescent` |

存在しないタグを勝手に作らないこと。迷ったら `catalog` の出力を grep して確かめる。

### Patch の制約（守らないと検証ゲートで落ちる）

- `schemaVersion` は **1**。
- `operators` は**ステージ順に並べる**: `source` → `field` → `modifier` → `material`。
  順序が崩れているだけで落ちる。
- 有効数の上下限: **source 1–2 / field 0–2 / modifier 1–3 / material 1**。
  material はちょうど 1 個。modifier は最低 1 個要る（何もしたくないなら `repeat` を count=1 で置く等）。
- 各 operator の `id` は Patch 内で一意。`generatorVersion` は `catalog` の `version` と一致させる。
- `parameters` は Generator ごとの `parameters[].id` と min/max に従う。
- `routes` の `source` は `audio:bass|mid|treble|level|beat|barPhase|beatPhase` / `time` / `operator:<opId>`、
  `target` は `<opId>.<paramId>`。自分自身を変調する route は落ちる。

```json
{
  "schemaVersion": 1,
  "seed": "wet-qilou-night",
  "operators": [
    { "id": "src", "generatorId": "qilouShutter", "generatorVersion": 1,
      "parameters": { "density": 28, "openness": 0.3, "wear": 0.6 } },
    { "id": "lens", "generatorId": "humidityLens", "generatorVersion": 1,
      "parameters": { "blobs": 3, "refraction": 0.55, "amount": 0.25 } },
    { "id": "rep", "generatorId": "repeat", "generatorVersion": 1,
      "parameters": { "count": 2 } },
    { "id": "mat", "generatorId": "wetConcrete", "generatorVersion": 1,
      "parameters": { "hue": 205, "speckle": 0.45, "sheen": 0.4 } }
  ],
  "routes": [
    { "source": "audio:level", "target": "lens.amount",
      "amount": 0.15, "polarity": "unipolar", "smoothing": 1.2 }
  ],
  "palette": { "mode": "analogous", "hueOffset": 205, "saturation": 28, "lightness": 42 },
  "composition": { "symmetry": 1, "scale": 1, "speed": 0.35 },
  "qualityTier": "medium"
}
```

（パラメータ名・範囲は `catalog` の出力が正。上の値は形の例。）

## いつ何を使うか

- **「すぐ変えて」** → `seed <s>`（狙いが緩いとき・ガチャでよいとき）か `patch <file>`（狙いが明確なとき）。
- **「後で変えて」「サビで」「あと 1 分くらいしたら」** → `event add`。
  秒で言われたら `--in`、小節で言われたら `--bar`。予約した id は出力に入っているので控えておく。
- **「今のを保存して」「さっきの流れをもう一回」** → `record start` … `record stop > file.json` → `load file.json`。
- **「しばらくいじらないで」** → `lock <sec>`（今から N 秒）。

## ユーザーの美的傾向

台湾の生活素材（騎楼のシャッター、鉄格子、ビニールカーテン、バスの座席柄）、環島の道中、
PA 機材やスピーカーのような即物的な構造物、2000 年代の映像機器（MiniDV・CRT・安い LED）を好む。
湿度と夜の街灯、蛍光灯の下の生活感が基調で、色は低彩度に寄る。時間の作り方はアンビエントで、
**変化は秒スケールでゆっくり**。ビートに合わせて爆発させたり、フラッシュで殴ったりはしない。
迷ったら `--transition slow`、`composition.speed` は低め、audio route の `amount` は控えめ・
`smoothing` は長めにする。`cut` と強い audio 変調は、明確に「切って」と言われたときだけ。
