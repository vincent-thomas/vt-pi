{
  description = "pi - AI coding agent CLI";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    pi-mono = {
      url = "github:earendil-works/pi";
      flake = false;
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      pi-mono,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        lib = pkgs.lib;
        nodejs = pkgs.nodejs_24;

        # ── 1. Base Pi package (upstream, no customizations) ─────────────────────
        piBase = pkgs.buildNpmPackage {
          pname = "pi-coding-agent";
          version = "0.80.3";

          src = pi-mono;

          # Hash covers all npm deps declared in the root package-lock.json.
          # Regenerate with:  nix build 2>&1 | awk '/got:/{print $2}'
          npmDepsHash = "sha256-geh8LH88OZybFXkR/jDeTdew6TNMdFM6jhCSYKn//dU=";

          inherit nodejs;

          # canvas is a dev-only test dep in packages/ai — skip native compilation.
          # tsgo and shx both ship as prebuilt/pure-JS so --ignore-scripts is safe.
          npmFlags = [ "--ignore-scripts" ];

          buildPhase = ''
            runHook preBuild

            # Expose node_modules/.bin (tsgo, shx, …) to npm run scripts.
            export PATH="$PWD/node_modules/.bin:$PATH"

            # packages/ai normally runs two network-fetching generate-* scripts
            # before tsc; strip them — the generated files are pre-committed.
            substituteInPlace packages/ai/package.json \
              --replace "npm run generate-models && npm run generate-image-models && " ""

            # Build all workspaces in order (tui → ai → agent → coding-agent).
            # The root build script also handles chmod and copy-assets for us.
            npm run build

            # ── Post-build npm audit ────────────────────────────────────────
            # Check the full dependency tree for known CVEs. The lockfile pins
            # tarball hashes (npmDepsHash), but a CVE can exist in a hash-verified
            # dependency — only a registry query catches those.
            #
            # Nix's sandbox may block network; if so, skip gracefully.
            echo ""
            echo "--- npm audit ---"
            # Capture exit code via || (works even with shell -e: the ||
            # chain means set -e never kills the build). Exit 0 = no vulns
            # at audit_level, 1 = vulns found, 2+ = error (no network).
            audit_exit=0
            npm audit --audit-level=high --json 2>&1 >/tmp/npm-audit.json || audit_exit=$?
            if [ -f /tmp/npm-audit.json ] && [ -s /tmp/npm-audit.json ]; then
              if [ "$audit_exit" -eq 0 ]; then
                echo "npm audit: no high/critical vulnerabilities"
              elif [ "$audit_exit" -eq 1 ]; then
                ADVISORY_COUNT=$(grep -o '"advisoryCount":[0-9]*' /tmp/npm-audit.json |\
                  grep -o '[0-9]*' || echo 0)
                echo "⚠  npm audit: $ADVISORY_COUNT high/critical advisory(ies) found"
                echo ""
                echo "  Run locally to inspect:  npm audit --audit-level=high"
              fi
            else
              echo "npm audit: registry unreachable (no network in Nix sandbox)"
              echo "  Run locally to check:  npm audit --audit-level=high"
            fi

            runHook postBuild
          '';

          doCheck = false; # Tests run in piCustomizations derivation

          installPhase = ''
            runHook preInstall

            out_pkg="$out/lib/node_modules/@earendil-works/pi-coding-agent"
            mkdir -p "$out_pkg"

            cp packages/coding-agent/package.json \
               packages/coding-agent/CHANGELOG.md \
               "$out_pkg/"
            cp -r packages/coding-agent/dist \
                  packages/coding-agent/docs \
                  packages/coding-agent/examples \
                  "$out_pkg/"

            # -L dereferences every workspace symlink on copy so $out contains
            # no dangling symlinks and needs no manual fixup.
            cp -rL node_modules "$out_pkg/"

            # Create a simple wrapper (no customizations yet)
            mkdir -p "$out/bin"
            makeWrapper "${nodejs}/bin/node" "$out/bin/pi" \
              --add-flags "$out_pkg/dist/cli.js"

            runHook postInstall
          '';

          nativeBuildInputs = [
            pkgs.makeWrapper
            pkgs.git
          ];

          meta = with pkgs.lib; {
            description = "Base Pi coding agent package (upstream, no customizations)";
            homepage = "https://github.com/badlogic/pi-mono";
            license = licenses.mit;
            mainProgram = "pi";
            platforms = platforms.unix;
          };
        };

        # ── 2. Customizations from this repo (extensions, lib, skills, AGENTS.md) ──
        piCustomizations =
          pkgs.runCommand "pi-customizations"
            {
              nativeBuildInputs = [
                nodejs
                pkgs.git
              ];
            }
            ''
              mkdir -p $out/extensions $out/lib $out/skills

              # Copy extensions + lib so ../lib/ imports work
              cp -r ${./pi/extensions}/. $out/extensions/
              cp -r ${./pi/lib}/. $out/lib/

              # Copy skills and AGENTS.md
              cp -r ${./pi/skills}/. $out/skills/
              cp ${./pi/AGENTS.md} $out/AGENTS.md

              # Run tests on extensions
              ${lib.concatMapStrings
                (testFile: ''
                  echo "Running test: ${testFile}"
                  ${nodejs}/bin/node $out/extensions/${testFile}
                '')
                (
                  map (f: lib.removePrefix (toString ./pi/extensions + "/") (toString f)) (
                    lib.filter (f: lib.hasSuffix ".test.ts" (baseNameOf (toString f))) (
                      lib.filesystem.listFilesRecursive ./pi/extensions
                    )
                  )
                )
              }
            '';

        # ── 3. Final Pi package (base + customizations) ───────────────────────
        pi =
          pkgs.runCommand "pi-with-customizations"
            {
              nativeBuildInputs = [ pkgs.makeWrapper ];
              passthru = {
                inherit piBase piCustomizations;
              };
              meta = piBase.meta // {
                description = "Pi coding agent with custom extensions and configuration";
              };
            }
            ''
              # Copy the base pi package
              cp -r ${piBase} $out
              chmod -R u+w $out

              # Add customizations to share/pi/
              mkdir -p $out/share/pi
              cp -r ${piCustomizations}/extensions $out/share/pi/extensions
              cp -r ${piCustomizations}/lib $out/share/pi/lib
              cp -r ${piCustomizations}/skills $out/share/pi/skills
              cp ${piCustomizations}/AGENTS.md $out/share/pi/AGENTS.md

              # Build --extension / --skill flags for every bundled item.
              # Skip test files (*.test.ts) - they're for build-time validation only.
              extra_flags=""
              for ext in $out/share/pi/extensions/*; do
                case "$(basename "$ext")" in
                  *.test.ts) ;; # Skip test files
                  *) extra_flags="$extra_flags --extension $ext" ;;
                esac
              done
              for skill in $out/share/pi/skills/*; do
                extra_flags="$extra_flags --skill $skill"
              done

              # Replace the wrapper with one that includes customizations
              rm $out/bin/pi
              makeWrapper "${nodejs}/bin/node" "$out/bin/pi" \
                --add-flags "$out/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js $extra_flags --append-system-prompt $out/share/pi/AGENTS.md"
            '';
      in
      {
        packages = {
          default = pi;
          pi = pi;
          piBase = piBase;
          piCustomizations = piCustomizations;
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
