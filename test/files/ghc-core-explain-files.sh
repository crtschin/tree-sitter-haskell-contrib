#!/usr/bin/env bash
# Emit the committed ghc-core-explain samples. Rule-firing and inlining logs
# have no phase banner, so $GHC_SRC holds nothing to harvest.

set -uo pipefail

dir="$(cd "$(dirname "$0")/../.." && pwd)/tree-sitter-ghc-core-explain/test/samples"
find "$dir" -type f -name '*.dump-*' | LC_ALL=C sort
