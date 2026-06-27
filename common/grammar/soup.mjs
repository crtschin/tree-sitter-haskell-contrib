/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// Balanced bracket/brace/paren "soup" with arbitrary non-delimiter tokens. The
// coarse-over-structure idiom the GHC grammars use to model metadata they
// don't (yet) parse: Core/STG [IdInfo] brackets, Cmm info-tables and static
// info. Spread makeSoupRules() into a grammar's `rules`. Reference `$._soup`
// (e.g. `seq("[", repeat($._soup), "]")`) and stop at the enclosing delimiter.
export function makeSoupRules() {
  return {
    _soup: ($) =>
      choice(
        $._soup_token,
        seq("(", repeat($._soup), ")"),
        seq("{", repeat($._soup), "}"),
        seq("[", repeat($._soup), "]"),
      ),
    _soup_token: ($) => token(/[^\s()\[\]{}]+/),
  };
}

// A `[..]` bracket whose contents are soup: the bracketed-metadata idiom the GHC
// grammars share (Core/STG [IdInfo], occurrence annotations). prec.dynamic lets GLR pick
// it over an alternative that also opens with `[`. Assign it to a named rule per grammar
// (idinfo, binder_annotation, ...), each a distinct node. Requires makeSoupRules().
export const soupBracket = ($) =>
  prec.dynamic(1, seq("[", repeat($._soup), "]"));
