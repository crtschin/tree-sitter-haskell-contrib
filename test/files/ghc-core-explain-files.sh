#!/usr/bin/env bash
# Emit the committed sample dumps for the ghc-core-explain grammar. Unlike the
# other GHC IL grammars, -ddump-rule-firings/-ddump-inlinings carry no phase
# banner, so there is nothing to harvest from $GHC_SRC by banner. The committed
# samples under test/samples (real GHC output, incl. a -dppr-debug verbose case)
# are the corpus gate instead. The ephemeral generated matrix (gen-corpus.sh)
# adds cross-version coverage.

set -uo pipefail

dir="$(cd "$(dirname "$0")/../.." && pwd)/tree-sitter-ghc-core-explain/test/samples"
find "$dir" -type f -name '*.dump-*' | LC_ALL=C sort
