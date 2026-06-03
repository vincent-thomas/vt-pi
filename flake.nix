{
  description = "pi - AI coding agent CLI";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";

    # Source-only input — not a flake itself, pinned to a commit in flake.lock
    pi-mono = {
      url = "github:badlogic/pi-mono";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, flake-utils, pi-mono }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        nodejs = pkgs.nodejs_24;

        pi = pkgs.buildNpmPackage {
          pname = "pi-coding-agent";
          version = "0.78.0";

          src = pi-mono;

          # Hash covers all npm deps declared in the root package-lock.json.
          # Regenerate with:  nix build 2>&1 | awk '/got:/{print $2}'
          npmDepsHash = "sha256-TxMiT7nJqLZRXKFoxb4FpsETGe3I99qU7olTgNsoQd4=";

          inherit nodejs;

          # canvas is a dev-only test dep in packages/ai — skip native compilation.
          # tsgo and shx both ship as prebuilt/pure-JS so --ignore-scripts is safe.
          npmFlags = [ "--ignore-scripts" ];

          # models.generated.ts / image-models.generated.ts are pre-committed, so
          # we skip the network-fetching generate-* scripts and call tsgo directly
          # for each workspace package in dependency order.
          buildPhase = ''
            runHook preBuild

            root=$(pwd)
            tsgo=$root/node_modules/.bin/tsgo
            shx=$root/node_modules/.bin/shx

            for pkg in tui ai agent coding-agent; do
              echo "--- building packages/$pkg ---"
              (cd packages/$pkg && $tsgo -p tsconfig.build.json)
            done

            chmod +x packages/coding-agent/dist/cli.js

            # Copy static assets (themes, export-html templates)
            ca=packages/coding-agent
            $shx mkdir -p $ca/dist/modes/interactive/theme
            $shx cp $ca/src/modes/interactive/theme/*.json \
                    $ca/dist/modes/interactive/theme/
            $shx mkdir -p $ca/dist/core/export-html/vendor
            $shx cp $ca/src/core/export-html/template.html \
                    $ca/src/core/export-html/template.css \
                    $ca/src/core/export-html/template.js \
                    $ca/dist/core/export-html/
            $shx cp $ca/src/core/export-html/vendor/*.js \
                    $ca/dist/core/export-html/vendor/

            runHook postBuild
          '';

          # Custom install: assemble a self-contained package from the
          # coding-agent workspace and replace all workspace symlinks with the
          # real compiled dist/ trees so there are no dangling symlinks in $out.
          installPhase = ''
            runHook preInstall

            pkg_root="$out/lib/node_modules/@earendil-works/pi-coding-agent"
            mkdir -p "$pkg_root"

            # ── coding-agent own content ──────────────────────────────────────
            cp packages/coding-agent/package.json "$pkg_root/"
            cp packages/coding-agent/CHANGELOG.md "$pkg_root/" 2>/dev/null || true
            cp -r packages/coding-agent/dist   "$pkg_root/"
            cp -r packages/coding-agent/docs   "$pkg_root/" 2>/dev/null || true

            # ── external node_modules (preserving symlinks for now) ───────────
            cp -r node_modules "$pkg_root/"

            # ── resolve workspace symlinks ────────────────────────────────────
            # After cp -r the workspace symlinks still point to the original
            # relative paths (e.g. ../../packages/tui) which no longer resolve
            # relative to their new location in $pkg_root/node_modules.
            # Replace each with a dist-only copy of the built workspace package.

            resolve_ws() {          # resolve_ws <link_path> <src_pkg_dir>
              local link="$1" src="$2"
              if [ -L "$link" ]; then
                rm "$link"
                mkdir -p "$link"
                cp "$src/package.json" "$link/"
                [ -d "$src/dist" ] && cp -r "$src/dist" "$link/"
              fi
            }

            nm="$pkg_root/node_modules"
            resolve_ws "$nm/@earendil-works/pi-tui"         packages/tui
            resolve_ws "$nm/@earendil-works/pi-ai"          packages/ai
            resolve_ws "$nm/@earendil-works/pi-agent-core"  packages/agent
            resolve_ws "$nm/@earendil-works/pi-coding-agent" packages/coding-agent

            # Remove example-extension workspace symlinks (dev-only)
            for ext in "$nm"/pi-extension-*; do
              [ -L "$ext" ] && rm "$ext"
            done

            # ── fix .bin entries that pointed at workspace packages ───────────
            # After the resolve_ws calls the real dist files exist, so most
            # relative .bin symlinks now resolve correctly.  Only remove the
            # ones that are still broken (shouldn't be any, but be defensive).
            for b in "$nm/.bin/"*; do
              [ -L "$b" ] && [ ! -e "$b" ] && rm "$b"
            done

            # ── pi binary wrapper ─────────────────────────────────────────────
            mkdir -p "$out/bin"
            makeWrapper "${nodejs}/bin/node" "$out/bin/pi" \
              --add-flags "$pkg_root/dist/cli.js"

            runHook postInstall
          '';

          nativeBuildInputs = [ pkgs.makeWrapper ];

          meta = with pkgs.lib; {
            description = "Coding agent CLI with read, bash, edit, write tools and session management";
            homepage = "https://github.com/badlogic/pi-mono";
            license = licenses.mit;
            mainProgram = "pi";
            platforms = platforms.unix;
          };
        };
      in
      {
        packages = {
          default = pi;
          pi = pi;
        };

        apps.default = {
          type = "app";
          program = "${pi}/bin/pi";
        };
        apps.pi = {
          type = "app";
          program = "${pi}/bin/pi";
        };
      }
    );
}
