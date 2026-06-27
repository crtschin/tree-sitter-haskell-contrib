#!/usr/bin/env bash
# Thin shim selecting the ghc-core dump corpus. See ghc-files.sh.
exec "$(dirname "$0")/ghc-files.sh" ghc-core
