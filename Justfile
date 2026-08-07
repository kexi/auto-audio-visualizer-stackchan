set shell := ["fish", "--no-config", "-c"]

default:
    @just --list

setup:
    pnpm install --frozen-lockfile
    lefthook install

configure:
    cmake -S . -B build/host -G Ninja -DCMAKE_BUILD_TYPE=Debug -DCMAKE_EXPORT_COMPILE_COMMANDS=ON

catalog-generate:
    node scripts/generate-stackchan-catalog.mjs

catalog-check:
    node scripts/generate-stackchan-catalog.mjs --check

compile: configure
    cmake --build build/host

run: compile
    ./build/host/stackchan-simulator

run-audio device="default": compile
    ./build/host/stackchan-simulator --audio-device {{quote(device)}}

audio-devices: compile
    ./build/host/stackchan-simulator --list-audio-devices

run-control: compile
    ./build/host/stackchan-simulator --control-stdio

host-bridge port="7877": compile
    node scripts/stackchan-host.mjs --port {{port}}

device-bridge device port="7877":
    node scripts/stackchan-serial.mjs --device {{device}} --port {{port}}

screenshot scene="semantic-synth" output="build/host/stackchan.bmp": compile
    SDL_VIDEODRIVER=dummy ./build/host/stackchan-simulator --scene {{scene}} --screenshot {{output}}

snapshot-check: compile
    SDL_VIDEODRIVER=dummy ./build/host/stackchan-simulator --scene semantic-synth --screenshot build/host/snapshot-check.bmp
    test -s build/host/snapshot-check.bmp

scene-check: compile
    for scene in bars waveform particles radial rings lissajous fluid smoke lava aurora semantic-synth; SDL_VIDEODRIVER=dummy ./build/host/stackchan-simulator --scene $scene --screenshot build/host/scene-$scene.bmp; test -s build/host/scene-$scene.bmp; end

test-host: compile
    ctest --test-dir build/host --output-on-failure

control-check: compile
    SDL_VIDEODRIVER=dummy ./build/host/stackchan-simulator --control-stdio < stackchan/test/control_requests.jsonl > build/host/control-responses.jsonl
    node scripts/check-stackchan-control.mjs build/host/control-responses.jsonl

image-check: compile
    SDL_VIDEODRIVER=dummy ./build/host/stackchan-simulator --control-stdio --screenshot build/host/image-check.bmp --require-image < stackchan/test/control_requests.jsonl > build/host/image-check-responses.jsonl
    test -s build/host/image-check.bmp

audio-check: compile
    SDL_AUDIODRIVER=dummy SDL_VIDEODRIVER=dummy ./build/host/stackchan-simulator --audio-device default --screenshot build/host/audio-check.bmp
    test -s build/host/audio-check.bmp

firmware:
    pio run --project-dir stackchan

firmware-clean:
    pio run --project-dir stackchan --target clean

web-install:
    pnpm install --frozen-lockfile

web-run:
    pnpm dev

web-compile:
    pnpm build

web-test:
    pnpm test

format:
    pnpm format
    rg --files stackchan -g '*.cpp' -g '*.hpp' | xargs clang-format -i

format-check:
    pnpm format:check
    rg --files stackchan -g '*.cpp' -g '*.hpp' | xargs clang-format --dry-run --Werror

lint:
    pnpm lint

actionlint:
    actionlint

pinact:
    pinact run --fix=false --no-api

pinact-verify:
    pinact run --check --verify --min-age 1

pin-actions:
    pinact run --min-age 1

actions: actionlint pinact-verify

secrets:
    gitleaks git --redact

secrets-staged:
    gitleaks git --pre-commit --staged --redact

all: catalog-check format-check lint actions secrets test-host control-check image-check audio-check scene-check web-test web-compile firmware
