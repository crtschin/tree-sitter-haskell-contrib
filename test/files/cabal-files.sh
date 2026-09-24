#!/usr/bin/env bash
# Emit every *.cabal file in $CABAL_SRC and $HLS_SRC.
#
# Each --deny is a file that is malformed by design. A grammar bug does not
# get a deny.

# Upstream parser-error fixtures.
deny_args=(--deny 'Cabal-tests/tests/ParserTests/errors/*')

# Installed package info (.ipi), a different format with no sections.
deny_args+=(--deny 'Cabal-tests/tests/ParserTests/ipi/*')

# Fixtures for the lenient upstream parser, invalid in the modern syntax:
#   - decreasing-indentation: the indent decreases mid-block.
#   - subsection: 'iff', a typo for 'if'.
#   - tab: brace-delimited bodies with tab layout.
#   - trailingfield: a top-level field after the first section.
#   - unknownsection: an unknown section type 'z'.
deny_args+=(
  --deny 'Cabal-tests/tests/ParserTests/regressions/decreasing-indentation.cabal'
  --deny 'Cabal-tests/tests/ParserTests/warnings/subsection.cabal'
  --deny 'Cabal-tests/tests/ParserTests/warnings/tab.cabal'
  --deny 'Cabal-tests/tests/ParserTests/warnings/trailingfield.cabal'
  --deny 'Cabal-tests/tests/ParserTests/warnings/unknownsection.cabal'
)

# Old 'base' descriptions with brace-delimited bodies (Library { ... }).
deny_args+=(
  --deny 'cabal-testsuite/PackageTests/Outdated/Issue8283/repo/base-3.0.3.1/base.cabal'
  --deny 'cabal-testsuite/PackageTests/Outdated/Issue8283/repo/base-3.0.3.2/base.cabal'
  --deny 'cabal-testsuite/PackageTests/Outdated/Issue8283/repo/base-4.0.0.0/base.cabal'
  --deny 'cabal-testsuite/PackageTests/Outdated/repo/base-3.0.3.1/base.cabal'
  --deny 'cabal-testsuite/PackageTests/Outdated/repo/base-3.0.3.2/base.cabal'
  --deny 'cabal-testsuite/PackageTests/Outdated/repo/base-4.0.0.0/base.cabal'
)

# T9640: a field at column 0 inside 'common warnings'. Upstream cabal accepts
# it. The grammar closes the section before that field.
deny_args+=(--deny 'cabal-testsuite/PackageTests/Regression/T9640/depend-on-custom-with-exe.cabal')

# HLS mid-edit fragments for completion and outline tests:
#   - completer.cabal: ends in a partial section header.
#   - autogen-completion.cabal: partial 'autogen-' field names with no colon.
#   - sectionarg.cabal: an 'if os(windows)' with no enclosing section.
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
