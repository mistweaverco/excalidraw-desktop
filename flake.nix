{
  description = "Excalidraw Desktop - Unofficial offline-first desktop client for Excalidraw";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, flake-utils, rust-overlay }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        overlays = [ rust-overlay.overlays.default ];
        pkgs = import nixpkgs { inherit system overlays; };

        rustToolchain = pkgs.rust-bin.stable.latest.default;

        linuxLibs = with pkgs; [
          webkitgtk_4_1
          gtk3
          openssl
          curl
          librsvg
          libappindicator
          glib
          cairo
          gdk-pixbuf
          dbus
          libsoup_3
        ];

        buildPkgs = with pkgs; [
          pkg-config
          wrapGAppsHook4
          rustToolchain
          nodejs_22
          pnpm_10
        ];
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = buildPkgs ++ linuxLibs;

          shellHook = ''
            mkdir -p "$HOME/.cache/corepack-shims"
            corepack enable --install-directory "$HOME/.cache/corepack-shims"
            export PATH="$HOME/.cache/corepack-shims:$PATH"
            export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath linuxLibs}:$LD_LIBRARY_PATH"
            export GIO_MODULE_DIR="${pkgs.glib}/lib/gio/modules"
            export XDG_DATA_DIRS="${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}:$XDG_DATA_DIRS"
          '';
        };

        packages.default = pkgs.rustPlatform.buildRustPackage {
          pname = "excalidraw-desktop";
          version = "0.5.2";

          src = ./.;

          cargoLock.lockFile = ./src-tauri/Cargo.lock;

          pnpmDeps = pkgs.fetchPnpmDeps {
            pname = "excalidraw-desktop-pnpm-deps";
            version = "0.5.2";
            src = ./.;
            pnpm = pkgs.pnpm_10;
            fetcherVersion = 3;
            hash = "sha256-XSbHzVlbXshIjNdji72mwVdZpCPjxRFjLzuJdsWcghc=";
          };

          nativeBuildInputs = with pkgs; [
            cargo-tauri.hook
            nodejs_22
            pnpm_10
            pnpmConfigHook
            pkg-config
            wrapGAppsHook4
          ];

          buildInputs = linuxLibs;

          cargoRoot = "src-tauri";
          buildAndTestSubdir = "src-tauri";
        };
      });
}
