/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// Case-insensitive regex for a keyword: each ASCII letter becomes [aA].
// Cabal lowercases every field and section name in both formats, so `Library`
// and `Package foo` are legal.
//
// `if`, `elif` and `else` stay case-sensitive. Cabal accepts `IF`, but no file
// in the Cabal tree uses it.
export function ci(str) {
  return new RegExp(
    str
      .split("")
      .map((c) =>
        /[a-zA-Z]/.test(c) ? `[${c.toLowerCase()}${c.toUpperCase()}]` : c,
      )
      .join(""),
  );
}

// Horizontal whitespace for both cabal grammars. Some old .cabal files hold
// U+00A0, which the scanner counts as indentation. The escape keeps an editor
// from eating the byte.
export const CABAL_WHITESPACE = /[ \t\r\u00a0]/;

// Externals for both cabal grammars, in the order of `enum Token` in
// common/scanners/cabal.c. Tree-sitter maps externals to that enum by index,
// so a grammar lists every token, e.g. cabal-project never uses `_section_name`.
export function makeCabalExternals($) {
  return [
    $._newline,
    $._indent,
    $._dedent,
    $._continuation,
    $._section_name,
    $._field_name,
  ];
}

// `pkg:sublib`, `pkg:*`, `*:*` and `pkg:{a, b}` as one token.
//
// A parser-level rule commits at the colon, so prose such as
// `Libraries: a framework` in a `description` becomes an ERROR.
// `token.immediate` does not help, because the commit happens at the colon. As
// one token, the shape matches whole or the lexer falls back to `identifier`
// and `":"`, so both grammars keep `":"` as a value token.
export function makeQualifiedNameRules({ precedence }) {
  const NAME = /[A-Za-z_][A-Za-z0-9_.\-]*/;
  return {
    qualified_name: ($) =>
      token(
        prec(
          precedence,
          seq(
            choice(NAME, "*"),
            ":",
            choice(
              NAME,
              "*",
              // Extras do not apply inside a token, so the spaces that Cabal
              // allows around `{`, `,` and `}` are explicit.
              seq(
                "{",
                /[ \t]*/,
                NAME,
                repeat(seq(/[ \t]*/, ",", /[ \t]*/, NAME)),
                /[ \t]*/,
                "}",
              ),
            ),
          ),
        ),
      ),
  };
}

export const PREDICATE_PRECEDENCE = {
  or: 1,
  and: 2,
  not: 3,
  call: 1,
};

// `extraArgChoices` names extra rules for `predicate_arg`, e.g. `["path"]` in
// cabal-project.
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

    // A value token is a path if it holds a `/`, is `.` or `..`, or starts with
    // a glob char. The precedence sits above `identifier`, so `vendor/*` and
    // `./pkg-a` in one list are both paths.
    //
    // The bare `.` alternative serves `hs-source-dirs: .`. As a cost, a lone
    // period in `description` prose also lexes as a path.
    path: ($) =>
      choice(
        token(
          prec(
            precs.path,
            choice(
              /\/[A-Za-z0-9_*?.\-\/]+/,
              /\.\.?(\/[A-Za-z0-9_*?.\-\/]*)?/,
              /[*?][A-Za-z0-9_*?.\-\/]+/,
              /[A-Za-z0-9_*?.\-]+(\/[A-Za-z0-9_*?.\-]*)+/,
            ),
          ),
        ),
        // A Windows drive path (`C:\ghc\bin\ghc.exe`). It must outrank
        // `qualified_name`, which reads `C:` as a package and a sublibrary. The
        // other alternatives must stay under `flag_token`, so
        // `-optP-I/usr/include` stays a flag.
        token(prec(precs.path_drive, /[A-Za-z]:[\\/][^\s,()"]*/)),
      ),

    constraint_op: ($) =>
      token(choice("==", ">=", "<=", "<", ">", "^>=", "&&", "||")),

    quoted_string: ($) => token(/"[^"\n]*"/),

    // Catch-all at the lowest precedence. With no catch-all, a value such as a
    // `;`-separated dir list or a plugin arg with `@` is an ERROR.
    text_fragment: ($) => token(prec(-1, /[^\s,()!*<>{}=\n"]+/)),

    comment: ($) => token(seq("--", /[^\n]*/)),
  };
}
