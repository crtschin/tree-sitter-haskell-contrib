{
  inputs = {
    nixpkgs.url = "flake:nixpkgs/nixpkgs-unstable";
    utils.url = "github:numtide/flake-utils";
    git-hooks = {
      url = "github:cachix/git-hooks.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    cabal-src = {
      url = "github:haskell/cabal";
      flake = false;
    };
    hls-src = {
      url = "github:haskell/haskell-language-server";
      flake = false;
    };
    ghc-src = {
      url = "github:ghc/ghc";
      flake = false;
    };
  };

  outputs =
    {
      nixpkgs,
      utils,
      git-hooks,
      cabal-src,
      hls-src,
      ghc-src,
      ...
    }:
    (utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ ];
        };

        # Shared code lives under ./common: grammar.js helpers (./common/grammar,
        # ./common/utils.mjs) and C scanners (./common/scanners). Every grammar
        # reaches them through a checked-in `common` symlink (-> ../common) that
        # `cp -rL` dereferences into the build source, so the build is
        # self-contained and local `tree-sitter generate` resolves the same paths.
        # A grammar that needs a C scanner additionally names it via `scanner`
        # (e.g. "cabal.c", "ghc-core.c"), materialized as src/scanner.c, the
        # declarative source of truth for which scanner it uses. stg/cmm/dump need
        # no scanner (scanner unset).
        buildTreeSitterPkg =
          {
            pname,
            language,
            scanner ? null,
          }:
          let
            composedSrc = pkgs.runCommand "${pname}-src" { } ''
              cp -rL ${./.}/${pname} $out
              chmod -R +w $out
              ${pkgs.lib.optionalString (scanner != null) ''
                cp ${./common/scanners}/${scanner} $out/src/scanner.c
              ''}
            '';
          in
          pkgs.tree-sitter.buildGrammar {
            inherit language;
            version = "0.1.0";
            src = composedSrc;
            generate = true;
          };

        treeSitterCabal = buildTreeSitterPkg {
          pname = "tree-sitter-cabal";
          language = "cabal";
          scanner = "cabal.c";
        };

        treeSitterCabalProject = buildTreeSitterPkg {
          pname = "tree-sitter-cabal-project";
          language = "cabal_project";
          scanner = "cabal.c";
        };

        treeSitterGhcCore = buildTreeSitterPkg {
          pname = "tree-sitter-ghc-core";
          language = "ghc_core";
          scanner = "ghc-core.c";
        };

        treeSitterGhcStg = buildTreeSitterPkg {
          pname = "tree-sitter-ghc-stg";
          language = "ghc_stg";
        };

        treeSitterGhcCmm = buildTreeSitterPkg {
          pname = "tree-sitter-ghc-cmm";
          language = "ghc_cmm";
        };

        treeSitterGhcDump = buildTreeSitterPkg {
          pname = "tree-sitter-ghc-dump";
          language = "ghc_dump";
        };

        # git-hooks.nix wires the generated git hooks into .git/hooks on `nix
        # develop` and `nix flake check` runs them. Entries shell out to the
        # justfile, the single source of truth shared with CI (see
        # .github/workflows/test.yml). fmt + static checks are cheap, so they
        # gate every commit. just test (the slow grammar build + corpus parse)
        # is disabled as a push gate and left to CI and manual runs.
        # Hooks assume the devShell is active (direnv `use flake`), so
        # tree-sitter/nixfmt/prettier and `nix` are on PATH for the recipes.
        pre-commit-check = git-hooks.lib.${system}.run {
          src = ./.;
          hooks =
            let
              just = "${pkgs.just}/bin/just";
            in
            {
              just-fmt = {
                enable = true;
                name = "just fmt check";
                entry = "${just} fmt check";
                language = "system";
                pass_filenames = false;
                stages = [ "pre-commit" ];
              };
              just-check = {
                enable = true;
                name = "just check";
                entry = "${just} check";
                language = "system";
                pass_filenames = false;
                stages = [ "pre-commit" ];
              };
              just-test = {
                enable = false;
                name = "just test";
                entry = "${just} test";
                language = "system";
                pass_filenames = false;
                stages = [ "pre-push" ];
              };
            };
        };
      in
      {
        packages = {
          tree-sitter-cabal = treeSitterCabal;
          tree-sitter-cabal-project = treeSitterCabalProject;
          tree-sitter-ghc-core = treeSitterGhcCore;
          tree-sitter-ghc-stg = treeSitterGhcStg;
          tree-sitter-ghc-cmm = treeSitterGhcCmm;
          tree-sitter-ghc-dump = treeSitterGhcDump;
        };

        # `nix flake check` runs the hooks over the tree, failing on a diff or
        # a broken grammar.
        checks.pre-commit-check = pre-commit-check;

        devShells.default = pkgs.mkShell {
          inherit (pre-commit-check) shellHook;
          buildInputs =
            with pkgs;
            [
              haskellPackages.cabal-fmt
              hyperfine
              tapview
              just
              nodejs
              nixfmt
              prettier
              tree-sitter
              typescript-language-server
              valgrind
              kdePackages.kcachegrind
            ]
            ++ pkgs.lib.optionals pkgs.stdenv.isLinux [
              perf
              flamegraph
            ]
            ++ pre-commit-check.enabledPackages;
          env.CABAL_SRC = "${cabal-src}";
          env.HLS_SRC = "${hls-src}";
          env.GHC_SRC = "${ghc-src}";
        };
      }
    ))
    // {
      # Single source of truth for test/gen-corpus.sh's opt-in multi-version
      # matrix (`gen-corpus.sh <lang> all`). Attr names resolve against the pinned
      # nixpkgs; bumping nixpkgs may require adjusting them. A plain string list,
      # not built packages, so `nix flake check`/CI never realise the GHC closures.
      ghcVersions = [
        "ghc910"
        "ghc912"
        "ghc914"
      ];
    };
}
