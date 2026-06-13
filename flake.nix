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
    utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ ];
        };

        # All C scanners live under ./common/scanners; a grammar that needs one
        # names it via `scanner` (e.g. "cabal.c", "ghc-core.c") and we materialize
        # it as src/scanner.c. `useCommon` likewise materializes ./common (the
        # shared grammar.js helpers). Each grammar's checked-in src/scanner.c is a
        # symlink into ./common/scanners for local builds; this cp makes the build
        # source self-contained and is the declarative source of truth for which
        # scanner a grammar uses. ghc-core uses its own layout scanner; stg/cmm/
        # dump need none (scanner unset).
        buildTreeSitterPkg =
          {
            pname,
            language,
            scanner ? null,
            useCommon ? true,
          }:
          let
            composedSrc = pkgs.runCommand "${pname}-src" { } ''
              cp -rL ${./.}/${pname} $out
              chmod -R +w $out
              ${pkgs.lib.optionalString (scanner != null) ''
                cp ${./common/scanners}/${scanner} $out/src/scanner.c
              ''}
              ${pkgs.lib.optionalString useCommon ''
                mkdir -p $out/common
                cp ${./common/utils.mjs} $out/common/utils.mjs
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
          useCommon = false;
        };

        treeSitterGhcStg = buildTreeSitterPkg {
          pname = "tree-sitter-ghc-stg";
          language = "ghc_stg";
          useCommon = false;
        };

        treeSitterGhcCmm = buildTreeSitterPkg {
          pname = "tree-sitter-ghc-cmm";
          language = "ghc_cmm";
          useCommon = false;
        };

        treeSitterGhcDump = buildTreeSitterPkg {
          pname = "tree-sitter-ghc-dump";
          language = "ghc_dump";
          useCommon = false;
        };

        # git-hooks.nix wires the generated git hooks into .git/hooks on `nix
        # develop` and `nix flake check` runs them. Entries shell out to the
        # justfile, the single source of truth shared with CI (see
        # .github/workflows/test.yml). fmt + static checks are cheap, so they
        # gate every commit; the slow grammar build + corpus parse gates pushes
        # instead. Hooks assume the devShell is active (direnv `use flake`), so
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
                enable = true;
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
    );
}
