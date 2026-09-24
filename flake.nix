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

        # `cp -rL` copies the target of the `common` symlink in each grammar, so
        # the build source is self-contained. `scanner` names a file in
        # ./common/scanners that replaces src/scanner.c.
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

        treeSitterGhcCoreExplain = buildTreeSitterPkg {
          pname = "tree-sitter-ghc-core-explain";
          language = "ghc_core_explain";
          scanner = "ghc-core-explain.c";
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

        # The hooks call the justfile recipes that CI calls, so they need the
        # devShell tools on PATH. `just test` is too slow for a push gate.
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

        ciPackages = with pkgs; [
          just
          nixfmt
          prettier
          tapview
          tree-sitter
        ];

        corpusEnv = {
          CABAL_SRC = "${cabal-src}";
          HLS_SRC = "${hls-src}";
          GHC_SRC = "${ghc-src}";
        };
      in
      {
        packages = {
          tree-sitter-cabal = treeSitterCabal;
          tree-sitter-cabal-project = treeSitterCabalProject;
          tree-sitter-ghc-core = treeSitterGhcCore;
          tree-sitter-ghc-core-explain = treeSitterGhcCoreExplain;
          tree-sitter-ghc-stg = treeSitterGhcStg;
          tree-sitter-ghc-cmm = treeSitterGhcCmm;
          tree-sitter-ghc-dump = treeSitterGhcDump;
        };

        checks.pre-commit-check = pre-commit-check;

        devShells = {
          default = pkgs.mkShell {
            inherit (pre-commit-check) shellHook;
            buildInputs =
              ciPackages
              ++ (with pkgs; [
                haskellPackages.cabal-fmt
                hyperfine
                nodejs
                typescript-language-server
                valgrind
                kdePackages.kcachegrind
              ])
              ++ pkgs.lib.optionals pkgs.stdenv.isLinux [
                pkgs.perf
                pkgs.flamegraph
              ]
              ++ pre-commit-check.enabledPackages;
            env = corpusEnv;
          };

          # CI uses this shell. It has no local tools and no git hooks, so the
          # CI cache stays small.
          ci = pkgs.mkShell {
            buildInputs = ciPackages;
            env = corpusEnv;
          };
        };
      }
    ))
    // {
      # The GHC versions for `gen-corpus.sh <lang> all`, as nixpkgs
      # haskell.compiler attributes. They are strings, so `nix flake check`
      # never builds the GHCs.
      ghcVersions = [
        "ghc910"
        "ghc912"
        "ghc914"
      ];
    };
}
