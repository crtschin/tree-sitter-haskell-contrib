/**
 * @file Tree-sitter container grammar for GHC dump streams (one or more
 *       banner-delimited -ddump-* sections: Core, STG, Cmm).
 * @author Curtis Chin Jen Sem <csochinjensem@gmail.com>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

import { banner } from "./common/grammar/haskell.mjs";

// GHC can emit several intermediate-language dumps into one stream, e.g.
//
//   ghc -ddump-simpl -ddump-stg-final -ddump-cmm
//
// each introduced by a `==================== <pass> ====================`
// banner.
//
// This grammar only splits that structure into (banner, body) sections and
// leaves each body as one opaque node.
//
// queries/injections.scm dispatches a body to the matching member grammar
// (ghc_core / ghc_stg / ghc_cmm) by banner text.
//
// Injection resolves at query/highlight time, so a bare parse keeps the bodies
// opaque.
export default grammar({
  name: "ghc_dump",

  extras: ($) => [/\s/],

  rules: {
    // Optional leading output (e.g. warnings before the first dump), then the
    // banner-delimited sections.
    source_file: ($) =>
      seq(optional($.body), repeat(choice($.section, $._interlude))),

    section: ($) => seq($.banner, optional($.body)),

    // ==================== Tidy Core ==================== (shared). Wins over
    // `_line` on a banner line via token precedence (equal length).
    banner,

    // A progress line ends the section before it, so a multi-module stream does
    // not inject it into a member grammar. The lines after it, up to the next
    // banner, are file-scope output like the preamble.
    _interlude: ($) => seq($.progress, optional($.body)),

    // `[1 of 2] Compiling M ( M.hs, M.o )`, and the Linking / Processing /
    // Including / Instantiating forms. Wins over `_line` via token precedence
    // (equal length).
    progress: ($) => token(prec(2, /\[\s*\d+ of\s*\d+\][^\n]*/)),

    // Everything up to the next banner or progress line, as a single node so
    // injections.scm can hand the whole range to a member grammar.
    body: ($) => repeat1($._line),

    _line: ($) => token(/[^\n]+/),
  },
});
