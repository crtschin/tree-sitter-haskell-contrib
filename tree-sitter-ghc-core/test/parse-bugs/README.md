# Known parse bugs

Minimal repros of ghc-core parse failures that are not fixed yet. Each file
parses with an ERROR node. No gate reads this directory, so the files do not
fail CI.

Both bugs sit in the GLR area around `trailing_sections` and `_item_sep`, where
the grammar regressed before. A fix needs a full harvest and gen-corpus run.
From `tree-sitter-ghc-core/`, parse a repro with this command:

    tree-sitter parse --lib-path result/parser --lang-name ghc_core test/parse-bugs/<file>

## Banner with no result-size line

`banner-no-resultsize.dump-simpl` holds a Core section whose banner has no
`Result size of ...` line after it, then a blank line and more content. GLR
commits the banner to `trailing_sections` and parses the bindings as soup. In
real dumps, the `-dsuppress-*` flags that strip the result-size line cause this
bug.

## Blank line in a trailing rules section

`blank-in-trailing-rules.dump-simpl` holds a trailing rules section with a blank
line. `trailing_sections` has no `_item_sep` slot, so the `_item_sep` that the
scanner emits at the blank line has nowhere to go. Real GHC rules dumps separate
rules with blank lines.

A fix that we tried on 2026-07-06 added `_item_sep` to the soup repeat and a
`[$.trailing_sections]` conflict. It fixed this repro, but 12 gen-corpus cells
and one inline test failed, so we reverted it. The greedy soup read a banner
over blank-line-separated binding groups as a trailing soup section. A real fix
must tell banner-to-section from banner-to-soup by structure.
