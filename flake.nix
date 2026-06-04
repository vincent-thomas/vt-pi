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

        # Enumerate *.test.ts files inside extensions/ at Nix evaluation time.
        # Store relative paths so all sibling files (e.g. ./logic.ts) remain
        # co-located under the same ${./extensions} Nix store path, keeping
        # relative imports intact at test-run time.
        testRelPaths = map
          (f: lib.removePrefix (toString ./extensions + "/") (toString f))
          (lib.filter
            (f: lib.hasSuffix ".test.ts" (builtins.baseNameOf (toString f)))
            (lib.filesystem.listFilesRecursive ./extensions));

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

            runHook postBuild
          '';

          checkPhase = ''
            runHook preCheck
            ${lib.concatMapStrings (rel: ''
              echo "running ${rel}"
              ${nodejs}/bin/node ${./extensions}/${rel}
            '') testRelPaths}
            runHook postCheck
          '';
          doCheck = true;

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

            # Bundle personal extensions and skills from the flake repo.
            mkdir -p "$out/share/pi/extensions"
            cp -r ${./extensions}/. "$out/share/pi/extensions/"

            mkdir -p "$out/share/pi/skills"
            cp -r ${./skills}/. "$out/share/pi/skills/"

            # Build --extension / --skill flags for every bundled item.
            # pi accepts both file and directory paths for each flag.
            extra_flags="--no-extensions --no-skills"
            for ext in "$out/share/pi/extensions"/*; do
              extra_flags="$extra_flags --extension $ext"
            done
            for skill in "$out/share/pi/skills"/*; do
              extra_flags="$extra_flags --skill $skill"
            done

            mkdir -p "$out/bin"
            makeWrapper "${nodejs}/bin/node" "$out/bin/pi" \
              --add-flags "$out_pkg/dist/cli.js $extra_flags"

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
