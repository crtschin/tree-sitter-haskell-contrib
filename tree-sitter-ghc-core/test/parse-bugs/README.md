# Known parse bugs (deferred)

Minimal repros of ghc-core parse failures the extraction-widening pass surfaced.
Each ERRORs today.

Nothing globs this directory, so they document the bugs without failing CI.

Both live in the delicate `trailing_sections` / `_item_sep` / GLR area the grammar
has regressed in before (a naive relaxation once took the harvest from 135 to 33).
Fixing them needs a full harvest + gen-corpus revalidation, not a quick patch.

- **`banner-no-resultsize.dump-simpl`**: a Core section whose banner is not
  followed by a `Result size of ...` line (then a blank line, then more content)
  mis-parses: GLR commits the banner to `trailing_sections` and swallows the
  bindings as soup. Adding a `result_size` line makes it parse. Real trigger:
  `-dsuppress-*` variants that strip the result-size line.
- **`blank-in-trailing-rules.dump-simpl`**: a trailing rules/soup section cannot
  contain a blank line: `trailing_sections` has no `_item_sep` slot, so the
  external `_item_sep` emitted at a blank line has nowhere to go. Real GHC rules
  dumps routinely blank-line-separate rules.
  ATTEMPT (2026-07-06, reverted): adding `_item_sep` to the soup repeat
  (`repeat(choice($._soup, $._item_sep))`) plus a `[$.trailing_sections]` GLR
  conflict fixes this repro but REGRESSES 12 gen-corpus cells (the `dump-occur-anal`
  set + a ppr-debug cell) and an inline test: absorbing `_item_sep` makes the soup
  greedy, so a banner over blank-line-separated binding groups is mis-read as a
  trailing soup section (this is bug #7's ambiguity, made worse). A real fix must
  disambiguate banner-to-section vs banner-to-soup structurally, not let soup eat
  separators.

To re-check: `tree-sitter parse --lib-path result/parser --lang-name ghc_core test/parse-bugs/<file>`
