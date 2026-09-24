/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// Separator combinators for the GHC grammars. They are rule builders, so call
// them inside a rule body.

export const sepBy1 = (sep, rule) => seq(rule, repeat(seq(sep, rule)));
export const sepBy = (sep, rule) => optional(sepBy1(sep, rule));
