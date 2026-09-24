/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// Balanced bracket "soup": nested (), {} and [] around arbitrary tokens. The GHC
// grammars use it for metadata that they do not parse, e.g. Core/STG [IdInfo]
// and Cmm info tables. Spread makeSoupRules() into a grammar's `rules`.
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

// A `[..]` bracket of soup. prec.dynamic lets GLR pick it over another
// alternative that opens with `[`. Needs makeSoupRules().
export const soupBracket = ($) =>
  prec.dynamic(1, seq("[", repeat($._soup), "]"));
