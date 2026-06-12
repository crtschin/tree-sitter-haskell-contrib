/**
 * @file Tree-sitter grammar for GHC STG dumps (e.g. `-ddump-stg-final` output).
 * @author Curtis Chin Jen Sem <csochinjensem@gmail.com>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// SCAFFOLD. This grammar currently models only the lexical surface of a GHC
// STG dump: phase banners, line comments, and bare whitespace-separated atoms.
// The real STG structure (top-level bindings, closures with \r/\u update
// flags, lambda forms, case/let, constructor and primop applications,
// cost-centre stacks) is still to be written. See README.md.
export default grammar({
  name: "ghc_stg",

  extras: ($) => [/\s/, $.comment],

  rules: {
    source_file: ($) => repeat($._item),

    _item: ($) => choice($.banner, $.atom),

    // GHC prints a phase banner around each dump, e.g.
    //   ==================== Final STG: ====================
    banner: ($) => token(prec(1, /={4,}[^\n]*={4,}/)),

    // Placeholder catch-all. Replace with real STG syntax rules.
    atom: ($) => token(/[^\s]+/),

    comment: ($) => token(seq("--", /[^\n]*/)),
  },
});
