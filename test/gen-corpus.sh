#!/usr/bin/env bash
# Regenerate the committed dump fixtures for one grammar from the nixpkgs-pinned
# GHC: compile the shared Haskell sources in test/fixtures/ and capture the
# dump(s), under flag sets the harvested corpus under-represents (-dsuppress
# extremes, source-note ticks). ghc-dump (the container) instead captures a
# multi-IL stream: several -ddump passes to stderr in one go.
#
# Pulls a GHC on demand via `nix shell` (deliberately not in the dev shell), so
# normal `test`/CI never compile. Review and commit the resulting diff; expect
# churn on a nixpkgs bump (the dump dialect tracks the compiler version).
#
# Usage: gen-corpus.sh <ghc-core|ghc-stg|ghc-cmm|ghc-dump>

set -euo pipefail

lang="${1:?usage: $0 <ghc-core|ghc-stg|ghc-cmm|ghc-dump>}"
repo="$(cd "$(dirname "$0")/.." && pwd)"
out="$repo/tree-sitter-$lang/test/fixtures/dumps"

case "$lang" in
    ghc-core) dump=-ddump-simpl;     ext=dump-simpl ;;
    ghc-stg)  dump=-ddump-stg-final; ext=dump-stg-final ;;
    ghc-cmm)  dump=-ddump-cmm;       ext=dump-cmm ;;
    ghc-dump) ext=dump ;;
    *) echo "unknown lang: $lang  (ghc-core|ghc-stg|ghc-cmm|ghc-dump)" >&2; exit 64 ;;
esac

mkdir -p "$out"
# cd to repo so the source path GHC bakes into SourceNote ticks stays relative
# (test/fixtures/Foo.hs), i.e. reproducible across machines.
cd "$repo"

ghc_pinned() { nix shell --inputs-from "$repo" nixpkgs#ghc --command ghc "$@"; }
# Drop GHC's wall-clock timestamp line so committed files don't churn on every
# regen (uniques are deterministic per compiler, so they don't).
strip_ts() { grep -vE '^[0-9]{4}-[0-9]{2}-[0-9]{2} .*UTC$'; }

if [[ "$lang" == ghc-dump ]]; then
    # The container consumes multi-section streams: enable several -ddump passes
    # at once and capture them (NOT -ddump-to-file, which splits them across
    # files). Without -ddump-to-file GHC writes the dumps to stdout, so capture
    # that; the result is one banner-delimited Core+STG+Cmm stream.
    tmp="$(mktemp -d)"
    ghc_pinned -c -fforce-recomp -O2 -ddump-simpl -ddump-stg-final -ddump-cmm \
        -outputdir "$tmp" test/fixtures/Bindings.hs >"$tmp/stream" 2>/dev/null
    strip_ts < "$tmp/stream" > "$out/Bindings.mixed.$ext"
    rm -rf "$tmp"
else
    # gen <module> <tag> <extra-ghc-flags...>: dump <module> to <module>.<tag>.<ext>.
    gen() {
        local mod="$1" tag="$2"; shift 2
        local tmp; tmp="$(mktemp -d)"
        ghc_pinned -c -fforce-recomp "$dump" -ddump-to-file \
            -dumpdir "$tmp" -outputdir "$tmp" "$@" "test/fixtures/$mod.hs" >/dev/null
        # GHC mirrors the source's relative path under -dumpdir; locate the dump.
        local f; f="$(find "$tmp" -name "$mod.$ext" -type f | head -1)"
        sed -En '/^={4,}/,$p' "$f" | strip_ts > "$out/$mod.$tag.$ext"
        rm -rf "$tmp"
    }
    gen Bindings bare             -O2
    gen Bindings suppress-uniques -O2 -dsuppress-uniques
    # -dsuppress-all and SourceNote ticks (-g3) only meaningfully shape the Core
    # pretty-printer's output; skip them for STG/Cmm.
    if [[ "$lang" == ghc-core ]]; then
        gen Bindings suppress-all -O2 -dsuppress-all
        gen Ticks    ticks        -O  -g3
    fi
fi

ghc_pinned --numeric-version | sed 's/^/generated with GHC /'
echo "wrote $(ls "$out" | wc -l) dumps to ${out#"$repo"/}; review & commit"
