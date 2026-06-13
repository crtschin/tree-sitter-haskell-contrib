/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// Balanced bracket/brace/paren "soup" with arbitrary non-delimiter tokens --
// the coarse-over-structure idiom the GHC grammars use to model metadata they
// don't (yet) parse: Core/STG [IdInfo] brackets, Cmm info-tables and static
// info. Spread makeSoupRules() into a grammar's `rules`; reference `$._soup`
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
