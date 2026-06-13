#!/usr/bin/env bash
# Emit paths to every *.cabal file in the configured corpora ($CABAL_SRC
# and $HLS_SRC). Used as the corpus selector for the cabal grammar.
#
# Each --deny below is a file that the grammar will not parse because the
# file is syntactically malformed by design (Cabal-side error fixtures,
# old syntax we don't support, or partial fragments used for editor
# tooling tests). Each entry is grouped with a comment naming the reason.

# Cabal's own parser-error fixtures: invalid input the upstream parser is expected to reject.
deny_args=(--deny 'Cabal-tests/tests/ParserTests/errors/*')

# .cabal-shaped files describing installed package info (.ipi).
# Different grammar (no sections, package-key/abi-depends fields).
deny_args+=(--deny 'Cabal-tests/tests/ParserTests/ipi/*')

# Warning/regression fixtures that exercise upstream cabal's lenient parser.
# They are intentionally not valid cabal syntax under the modern grammar we model.
#   decreasing-indentation: field/section indent decreases mid-block.
#   subsection: writes 'iff', a typo for the 'if' keyword.
#   tab: stanzas written with brace-delimited bodies and tab layout.
#   trailingfield: top-level field after sections have begun.
#   unknownsection: declares a section type 'z' the grammar doesn't know.
deny_args+=(
  --deny 'Cabal-tests/tests/ParserTests/regressions/decreasing-indentation.cabal'
  --deny 'Cabal-tests/tests/ParserTests/warnings/subsection.cabal'
  --deny 'Cabal-tests/tests/ParserTests/warnings/tab.cabal'
  --deny 'Cabal-tests/tests/ParserTests/warnings/trailingfield.cabal'
  --deny 'Cabal-tests/tests/ParserTests/warnings/unknownsection.cabal'
)

# Historical 'base' package descriptions using brace-delimited section bodies
# (Library { ... }), an old syntax we intentionally don't parse.
deny_args+=(
  --deny 'cabal-testsuite/PackageTests/Outdated/Issue8283/repo/base-3.0.3.1/base.cabal'
  --deny 'cabal-testsuite/PackageTests/Outdated/Issue8283/repo/base-3.0.3.2/base.cabal'
  --deny 'cabal-testsuite/PackageTests/Outdated/Issue8283/repo/base-4.0.0.0/base.cabal'
  --deny 'cabal-testsuite/PackageTests/Outdated/repo/base-3.0.3.1/base.cabal'
  --deny 'cabal-testsuite/PackageTests/Outdated/repo/base-3.0.3.2/base.cabal'
  --deny 'cabal-testsuite/PackageTests/Outdated/repo/base-4.0.0.0/base.cabal'
)

# T9640: 'ghc-options: -Wall' sits at column 0 inside 'common warnings' (no indentation).
# Upstream cabal tolerates this. Our grammar treats the field as belonging to the
# (already-closed) section above.
deny_args+=(--deny 'cabal-testsuite/PackageTests/Regression/T9640/depend-on-custom-with-exe.cabal')


# HLS testdata: deliberately partial / mid-edit cabal fragments used to exercise
# the language server's completion and outline features.
#   completer.cabal: ends mid-section header ('co' on the last line).
#   autogen-completion.cabal: 'autogen-' partial field names with no colon, scattered
#                             across several sections.
#   sectionarg.cabal: a bare 'if os(windows)' conditional with no enclosing section.
deny_args+=(
  --deny 'plugins/hls-cabal-plugin/test/testdata/completer.cabal'
  --deny 'plugins/hls-cabal-plugin/test/testdata/completion/autogen-completion.cabal'
  --deny 'plugins/hls-cabal-plugin/test/testdata/outline-cabal/sectionarg.cabal'
)

set -o pipefail
exec "$(dirname "$0")/find-corpus.sh" \
    --root "$CABAL_SRC" \
    --root "$HLS_SRC" \
    --include '*.cabal' \
    "${deny_args[@]}"
