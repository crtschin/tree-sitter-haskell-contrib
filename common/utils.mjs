/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

export const PREDICATE_PRECEDENCE = {
  or: 1,
  and: 2,
  not: 3,
  call: 1,
};

// Predicate-expression rules shared by the cabal and cabal-project grammars. Spread the
// result into the grammar's `rules`.
//
// `extraArgChoices`: rule names (looked up off `$`) appended to the `predicate_arg`
// choice. cabal-project passes `["path"]`. cabal omits it (no `path` token).
export function makePredicateRules({ extraArgChoices = [] } = {}) {
  return {
    _predicate_expr: ($) =>
      choice(
        $.predicate_or,
        $.predicate_and,
        $.predicate_not,
        $._predicate_atom,
      ),

    predicate_or: ($) =>
      prec.left(
        PREDICATE_PRECEDENCE.or,
        seq($._predicate_expr, "||", $._predicate_expr),
      ),

    predicate_and: ($) =>
      prec.left(
        PREDICATE_PRECEDENCE.and,
        seq($._predicate_expr, "&&", $._predicate_expr),
      ),

    predicate_not: ($) =>
      prec(PREDICATE_PRECEDENCE.not, seq("!", $._predicate_expr)),

    _predicate_atom: ($) =>
      choice($.predicate_call, $.predicate_paren, $.boolean, $.identifier),

    predicate_paren: ($) => seq("(", $._predicate_expr, ")"),

    predicate_call: ($) =>
      prec(
        PREDICATE_PRECEDENCE.call,
        seq(
          field("fn", $.identifier),
          "(",
          optional(field("arg", $.predicate_arg)),
          ")",
        ),
      ),

    predicate_arg: ($) =>
      repeat1(
        choice(
          $.boolean,
          $.version,
          $.iso_date,
          $.qualified_name,
          $.flag_token,
          $.integer,
          $.identifier,
          $.constraint_op,
          ...extraArgChoices.map((name) => $[name]),
          ",",
        ),
      ),
  };
}

// `precs`: per-grammar lexical precedence values. Do not share one map across
// both grammars. Cabal inserts `module_name` between `version` and
// `qualified_name`, shifting all precedences above it by 1.
export function makeValueTokenRules({ precs }) {
  return {
    boolean: ($) => token(prec(precs.boolean, choice("True", "False"))),

    iso_date: ($) =>
      token(
        prec(
          precs.iso_date,
          /[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2}:[0-9]{2}Z)?/,
        ),
      ),

    url: ($) =>
      token(
        prec(precs.url, /(https?|file|ftp|git|ssh)\+?[a-z]*:\/\/?[^\s,()<>]+/),
      ),

    version: ($) => token(prec(precs.version, /[0-9]+(\.[0-9]+)+(\.\*)?/)),

    flag_token: ($) =>
      token(prec(precs.flag_token, /[+\-][A-Za-z][A-Za-z0-9_-]*/)),

    integer: ($) => token(prec(precs.integer, /[0-9]+/)),

    constraint_op: ($) =>
      token(choice("==", ">=", "<=", "<", ">", "^>=", "&&", "||")),

    quoted_string: ($) => token(/"[^"\n]*"/),

    comment: ($) => token(seq("--", /[^\n]*/)),
  };
}
