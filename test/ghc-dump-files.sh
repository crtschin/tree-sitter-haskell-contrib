#!/usr/bin/env bash
# Thin shim selecting the ghc-dump container corpus (union of all ILs). See ghc-files.sh.
exec "$(dirname "$0")/ghc-files.sh" ghc-dump
