# tree-sitter-haskell-contrib

Tree-sitter grammars for Haskell-ecosystem file formats.

- `tree-sitter-cabal`: `.cabal` package description files
- `tree-sitter-cabal-project`: `cabal.project` and `*.project` workspace files
- `tree-sitter-ghc-core`: GHC Core dumps (`-ddump-simpl` and the other Core passes)
- `tree-sitter-ghc-core-explain`: GHC simplifier logs (`-ddump-rule-firings`, `-ddump-inlinings`)
- `tree-sitter-ghc-stg`: GHC STG dumps (`-ddump-stg-final` and the other STG passes)
- `tree-sitter-ghc-cmm`: GHC Cmm dumps (`-ddump-cmm` and the pipeline-stage passes)
- `tree-sitter-ghc-dump`: a container grammar that injects the grammars above into multi-section dump files

The `.cabal` grammar started as a fork of [magus/tree-sitter-cabal](https://gitlab.com/magus/tree-sitter-cabal/).

## Commands

Enter the dev shell with `nix develop`. It provides tree-sitter, just, and the
other tools. The top-level justfile runs each command across every grammar:

| Command            | Description                                                  |
|--------------------|--------------------------------------------------------------|
| `just`             | Run `just test` (default)                                    |
| `just test`        | Run every test suite to completion, with the GHC dump matrix over every `ghcVersions` GHC in `flake.nix` (slow) |
| `just test --fast` | Run `just test` with the default nixpkgs GHC alone           |
| `just build`       | Generate each parser and build its shared library            |
| `just check`       | Build each grammar without a `result` symlink                |
| `just fmt`         | Format the grammar files with prettier and the flake with nixfmt |
| `just gen-corpus`  | Parse the generated GHC dump matrix for the default GHC. Set `GEN_GHC=all` for every `ghcVersions` GHC |
| `just clean`       | Remove build artifacts                                       |

`just <name>::<cmd>` runs a command for one grammar. `<name>` is one of
`cabal`, `cabal-project`, `ghc-core`, `ghc-core-explain`, `ghc-stg`, `ghc-cmm`,
or `ghc-dump`.

## Testing

The cabal grammars parse a corpus from the
[cabal](https://github.com/haskell/cabal) and
[haskell-language-server](https://github.com/haskell/haskell-language-server)
source trees. The GHC grammars parse real dumps from the GHC test suite. Also,
`gen-corpus` compiles a set of fixtures with GHC over a matrix of dump and
display flags, then parses the output.

## References

- [Tree-sitter: Creating parsers](https://tree-sitter.github.io/tree-sitter/creating-parsers)
- [Cabal: .cabal file reference](https://cabal.readthedocs.io/en/stable/cabal-package.html)
- [Cabal: cabal.project reference](https://cabal.readthedocs.io/en/stable/cabal-project.html)
- [GHC: dumping intermediate output](https://downloads.haskell.org/ghc/latest/docs/users_guide/debugging.html)

---

Disclaimer: co-produced with a coding agent.
