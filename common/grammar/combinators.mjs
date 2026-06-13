/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// Separator combinators shared by the GHC grammars. Plain rule-builders (not
// rules), so import and call them inside rule bodies.

export const sepBy1 = (sep, rule) => seq(rule, repeat(seq(sep, rule)));
export const sepBy = (sep, rule) => optional(sepBy1(sep, rule));
