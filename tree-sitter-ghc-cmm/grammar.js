/**
 * @file Tree-sitter grammar for GHC Cmm dumps (e.g. `-ddump-cmm` output).
 * @author Curtis Chin Jen Sem <csochinjensem@gmail.com>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// SCAFFOLD. This grammar currently models only the lexical surface of a GHC
// Cmm dump: phase banners, line comments, and bare whitespace-separated atoms.
// The real Cmm structure (data/proc sections, info tables, basic-block labels,
// typed memory access like I64[...], registers Sp/Hp/R1, and `//` comments) is
// still to be written. See README.md.
export default grammar({
  name: "ghc_cmm",

  extras: ($) => [/\s/, $.comment],

  rules: {
    source_file: ($) => repeat($._item),

    _item: ($) => choice($.banner, $.atom),

    // GHC prints a phase banner around each dump, e.g.
    //   ==================== Output Cmm ====================
    banner: ($) => token(prec(1, /={4,}[^\n]*={4,}/)),

    // Placeholder catch-all. Replace with real Cmm syntax rules.
    atom: ($) => token(/[^\s]+/),

    comment: ($) => token(seq("//", /[^\n]*/)),
  },
});
