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
        devShells.default = pkgs.mkShell {
          packages = (with pkgs; [
            actionlint
            clang-tools
            cmake
            direnv
            fish
            findutils
            git
            gitleaks
            just
            lefthook
            llvmPackages.clang
            ninja
            nix-direnv
            nodejs_24
            pinact
            platformio
            pkg-config
            pnpm_10
            ripgrep
            SDL2
            SDL2_image
          ]) ++ pkgs.lib.optionals pkgs.stdenv.isLinux (with pkgs; [
            chromium
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
          ]);

          shellHook = ''
            export PLATFORMIO_CORE_DIR="$PWD/.platformio"
            ${pkgs.lib.optionalString pkgs.stdenv.isLinux ''
              export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
              export CHROMIUM_BIN="${pkgs.chromium}/bin/chromium"
            ''}

            # devShell に入るたび、リポジトリ管理の pre-commit hook を同期する。
            if git rev-parse --git-dir >/dev/null 2>&1; then
              lefthook install >/dev/null
            fi
          '';
        };
      });
}
