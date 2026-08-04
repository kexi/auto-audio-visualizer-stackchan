{
  description = "VJ Overlay Tool dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        # ヘッドレスブラウザでの検証用シェル。
        # Playwright が自前でダウンロードする Chromium は共有ライブラリ
        # (libnspr4.so 等) を見つけられないため、nix 側の chromium と
        # 必要な system library を供給する。
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            chromium
            # headless Chrome が要求する system library 群
            nss
            nspr
            atk
            cups
            libdrm
            mesa
            pango
            cairo
            alsa-lib
            at-spi2-atk
            libxdamage
            libxrandr
            libxcomposite
            libxcursor
            libxfixes
            libxi
            libxtst
            dbus
            expat
            glib
            gtk3
          ];

          shellHook = ''
            # Playwright に自前の Chromium をダウンロードさせない。
            export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
            # nix が提供する Chromium の実行パス。
            # 注意: Playwright はこの環境変数を自動では参照しない。実測で、
            # 環境変数だけに頼った chromium.launch() は失敗する。
            # テスト側で launch({ executablePath: process.env.CHROMIUM_BIN }) の
            # ように明示的に渡すこと。
            export CHROMIUM_BIN="${pkgs.chromium}/bin/chromium"
          '';
        };
      });
}
