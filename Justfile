set shell := ["fish", "--no-config", "-c"]

default:
    @just --list

setup:
    pnpm install --frozen-lockfile
    lefthook install

configure:
    cmake -S . -B build/host -G Ninja -DCMAKE_BUILD_TYPE=Debug -DCMAKE_EXPORT_COMPILE_COMMANDS=ON

compile: configure
    cmake --build build/host

run: compile
    ./build/host/stackchan-simulator

screenshot scene="semantic-synth" output="build/host/stackchan.bmp": compile
    SDL_VIDEODRIVER=dummy ./build/host/stackchan-simulator --scene {{scene}} --screenshot {{output}}

snapshot-check: compile
    SDL_VIDEODRIVER=dummy ./build/host/stackchan-simulator --scene semantic-synth --screenshot build/host/snapshot-check.bmp
    test -s build/host/snapshot-check.bmp

test-host: compile
    ctest --test-dir build/host --output-on-failure

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

all: format-check lint actions secrets test-host snapshot-check web-test web-compile
