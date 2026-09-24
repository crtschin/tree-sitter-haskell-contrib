/**
 * @file Tree-sitter container grammar for GHC dump streams (one or more
 *       banner-delimited -ddump-* sections: Core, STG, Cmm).
 * @author Curtis Chin Jen Sem <csochinjensem@gmail.com>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

import { banner } from "./common/grammar/haskell.mjs";

// Splits a stream of GHC dumps (e.g. `-ddump-simpl -ddump-stg-final`) into
// banner and body sections. queries/injections.scm hands each body to the
// member grammar that its banner names, so a bare parse keeps bodies opaque.
export default grammar({
  name: "ghc_dump",

  extras: ($) => [/\s/],

  rules: {
    // The leading body holds output before the first banner, e.g. warnings.
    source_file: ($) => seq(optional($.body), repeat($.section)),

    section: ($) => seq($.banner, optional($.body)),

    // Token precedence lets the banner beat `_line` on an equal-length match.
    banner,

    // One node, so an injection gets the whole range up to the next banner.
    body: ($) => repeat1($._line),

    _line: ($) => token(/[^\n]+/),
  },
});
