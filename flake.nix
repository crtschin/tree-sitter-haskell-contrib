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
  };

  outputs =
    {
      nixpkgs,
      utils,
      git-hooks,
      cabal-src,
      hls-src,
      ...
    }:
    utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ ];
        };

        # Grammars sharing the C scanner symlink src/scanner.c (-> the repo-root
        # ./scanner/scanner.c) and the common grammar helpers (./common) to it.
        # Nix's import of ./${pname} doesn't reach outside that subtree, so we
        # materialize those into real files before handing the source to
        # buildGrammar. `useScanner` / `useCommon` opt a grammar out when it
        # carries neither (e.g. ghc-core).
        buildTreeSitterPkg =
          {
            pname,
            language,
            useScanner ? true,
            useCommon ? true,
          }:
          let
            composedSrc = pkgs.runCommand "${pname}-src" { } ''
              cp -rL ${./.}/${pname} $out
              chmod -R +w $out
              ${pkgs.lib.optionalString useScanner ''
                cp ${./scanner/scanner.c} $out/src/scanner.c
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
        };

        treeSitterCabalProject = buildTreeSitterPkg {
          pname = "tree-sitter-cabal-project";
          language = "cabal_project";
        };

        treeSitterGhcCore = buildTreeSitterPkg {
          pname = "tree-sitter-ghc-core";
          language = "ghc_core";
          useScanner = false;
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
        };
      }
    );
}
