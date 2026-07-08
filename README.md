# tree-sitter-haskell-contrib

Tree-sitter grammars for Haskell-ecosystem file formats.

- **tree-sitter-cabal**: `.cabal` package description files
- **tree-sitter-cabal-project**: `cabal.project` and `*.project` workspace files
- **tree-sitter-ghc-core**: GHC Core dumps (`-ddump-simpl` and the other Core passes)
- **tree-sitter-ghc-core-explain**: GHC simplifier-explanation logs (`-ddump-rule-firings`, `-ddump-inlinings`)
- **tree-sitter-ghc-stg**: GHC STG dumps (`-ddump-stg-final` and the other STG passes)
- **tree-sitter-ghc-cmm**: GHC Cmm dumps (`-ddump-cmm` and the pipeline-stage passes)
- **tree-sitter-ghc-dump**: container grammar that injects the per-IL grammars into multi-section dump files

The `.cabal` grammar was initially forked from [magus/tree-sitter-cabal](https://gitlab.com/magus/tree-sitter-cabal/).

## Setup

```sh
nix develop   # enter dev shell (provides tree-sitter, just, etc.)
```

## Commands

All commands run across every grammar via the top-level justfile.

| Command            | Description                                                  |
|--------------------|--------------------------------------------------------------|
| `just`             | Run every grammar's full suite (default)                     |
| `just test`        | Per grammar: query compile, parse-corpus, inline tests, and the GHC dump matrix across every `flake.nix` `ghcVersions` GHC. Runs all suites to completion, then fails if any failed (heavy) |
| `just test --fast` | Same, but the GHC dump matrix uses only the default nixpkgs GHC (quick) |
| `just build`       | Generate each parser and build its shared library            |
| `just check`       | Validate every grammar without building                      |
| `just fmt`         | Format grammar files and the flake (prettier and nixfmt)     |
| `just gen-corpus`  | Build and parse the GHC dump-flag matrix as a TAP suite for the default GHC; set `GEN_GHC=all` for every `ghcVersions` GHC (needs a GHC compiler) |
| `just clean`       | Remove build artifacts                                       |

Per-grammar commands are available as `just <name>::<cmd>`, where `<name>` is one
of `cabal`, `cabal-project`, `ghc-core`, `ghc-stg`, `ghc-cmm`, `ghc-dump`. The
cabal grammars also carry `flamegraph`, `bench`, `valgrind`, and `stats` targets
for profiling the scanner over their corpora.

## Testing

The cabal grammars parse a corpus drawn from the
[cabal](https://github.com/haskell/cabal) and
[haskell-language-server](https://github.com/haskell/haskell-language-server)
source trees.

The GHC grammars parse a harvested corpus of real dumps from the GHC test suite.
On top of that, `gen-corpus` compiles a handful of fixtures with GHC across a
matrix of dump and display flags.

- `just test` runs the matrix once per version listed in `flake.nix`
  `ghcVersions`, validating against several compilers (heavy: pulls each closure).

- `just test --fast` and the CI pull-request gate restrict it to the one GHC in
  the pinned nixpkgs.

## References

- [Tree-sitter: Creating parsers](https://tree-sitter.github.io/tree-sitter/creating-parsers)
- [Cabal: .cabal file reference](https://cabal.readthedocs.io/en/stable/cabal-package.html)
- [Cabal: cabal.project reference](https://cabal.readthedocs.io/en/stable/cabal-project.html)
- [GHC: dumping intermediate output](https://downloads.haskell.org/ghc/latest/docs/users_guide/debugging.html)

---

Disclaimer: co-produced with a coding agent.
