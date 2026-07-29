/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// Case-insensitive regex for a keyword: each ASCII letter becomes [aA].
//
// Both formats need it. Cabal lowercases every field and section name as it builds them
// (Distribution.Fields.Field.mkName), and that module is shared by the .cabal and
// cabal.project parsers, so `Library` and `Package foo` are both legal.
//
// Not applied to `if`/`elif`/`else`, which the same lowercasing also makes case-insensitive.
// Both grammars match them as plain literals, so `IF flag(dev)` is legal input they reject.
// Left alone on the evidence: capitalised section headers appear in ~700 files of the Cabal
// tree, capitalised conditionals in none. Fixing it would mean named keyword nodes in place
// of the anonymous `"if"` tokens the shared highlight queries capture, for no real input.
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

// Horizontal whitespace for both cabal grammars. U+00A0 (non-breaking space) shows up in
// some old .cabal files, and the scanner already counts it as indentation
// (common/scanners/cabal.c), so the grammars have to accept it mid-line as well. Written
// as an escape rather than a literal byte so an editor cannot silently eat it.
export const CABAL_WHITESPACE = /[ \t\r\u00a0]/;

// The externals array for both cabal grammars. Order is the scanner's `enum Token` order
// (common/scanners/cabal.c); tree-sitter matches externals to that enum by index, so a
// grammar declares even the tokens it never uses. Keeping one definition here means the
// two grammars cannot drift out of alignment with the scanner.
//
// Currently unused per grammar: `_section_name` in cabal-project (no section concept).
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

// `pkg:sublib`, `pkg:*`, `*:*`, and `pkg:{a, b}`. One atomic token, shared by both grammars.
//
// Atomic is not a style choice, it is forced. A parser-level rule with `package:` and
// `sublibrary:` fields would be friendlier to query, and cabal-project used to have one, but
// any such rule commits at the colon and tree-sitter cannot backtrack over a consumed token.
// `.cabal` prose then breaks: in Cabal's own Cabal.cabal,
//
//     description:
//       The Haskell Common Architecture for Building Applications and
//       Libraries: a framework defining a common interface ...
//
// the parser takes `Libraries` as a package, finds no sublibrary after the colon, and emits
// an ERROR. Eleven real files in the corpus failed that way. Making the colon or the
// sublibrary `token.immediate` does not help, because the commitment happens at the colon,
// before the constraint is tested. As one token the whole shape either matches or the lexer
// falls back to `identifier` + `":"`, which is why both grammars keep `":"` among their value
// tokens.
//
// Consumers that want the halves can split the node text on the first `:`; that is cheap, and
// unlike an ERROR node it is always available.
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
              // A sublibrary set. Cabal allows spaces after `{`, around the commas, and
              // before `}`; inside a token, extras do not apply, so fold them in by hand.
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

    // Filesystem paths and globs, one definition for both grammars. Must sit above
    // `identifier` so a path is a single node: `packages: vendor/*` used to lex as an
    // identifier in cabal-project while `./pkg-a` beside it lexed as a path, so one list
    // produced two node types and two highlight colours.
    //
    // The bare `.`/`..` alternative is deliberately kept for `.cabal` too, where
    // `hs-source-dirs: .` is ordinary. The cost is that a lone period in `description`
    // prose (as in `...(http://x).`) also becomes a path. Getting real paths right is
    // worth more than prose precision, and both render as string-ish anyway.
    //
    // The rule in one line: a value token is a path if it contains a `/`, or is `.`/`..`,
    // or starts with a glob character. So `csrc/codec.h`, `vendor/*`, `pkg-*/` and
    // `packages/**/*.cabal` are each one node, while a plain name stays an identifier and a
    // bare `*` (glob-all, `packages: *`) stays its own token.
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
        // A Windows drive-letter path (`with-compiler: C:\ghc\bin\ghc.exe`). Separate
        // because its precedence pulls the other way: it has to outrank `qualified_name`,
        // which would otherwise read `C:` as package:sublibrary and leave the backslash as
        // an ERROR, while the alternatives above have to stay under `flag_token` so
        // `-optP-I/usr/include` keeps its flag instead of becoming one path.
        token(prec(precs.path_drive, /[A-Za-z]:[\\/][^\s,()"]*/)),
      ),

    constraint_op: ($) =>
      token(choice("==", ">=", "<=", "<", ">", "^>=", "&&", "||")),

    quoted_string: ($) => token(/"[^"\n]*"/),

    // Catch-all for value text no other token claims, at the lowest precedence so it only
    // fills gaps. Both grammars need it: without it, a Windows compiler path
    // (`C:\ghc\bin\ghc.exe`), a semicolon-separated dir list, or a plugin arg with `@`
    // produces ERROR nodes instead of degrading.
    text_fragment: ($) => token(prec(-1, /[^\s,()!*<>{}=\n"]+/)),

    comment: ($) => token(seq("--", /[^\n]*/)),
  };
}
