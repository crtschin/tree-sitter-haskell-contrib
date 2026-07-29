; Extraction contract for the extract-golden gate (test/runners/extract-golden.sh).
; Captures the semantic payload a cabal.project exposes: field name/value splits,
; package globs, constraint atoms, stanza headers, and conditional predicates.
; The golden asserts exact extracted text, not merely absence of ERROR nodes.

; Field name plus each leaf value token, so a value mis-split shows up as a span.
; `value` is one node spanning every continuation line, which pins the layout rule.
(field name: (field_name) @field.name)
(field value: (field_value) @field.value)
(field_value (identifier)     @value.identifier)
(field_value (path)           @value.path)
; Catch-all for text no other token claims (`C:\ghc\bin\ghc.exe`, a `;`-separated
; dir list, a plugin arg with `@`). Without it these produced ERROR nodes.
(field_value (text_fragment)  @value.text)
(field_value (boolean)        @value.boolean)
; A hex commit SHA in `tag:` (`8b2a1e3c…`) is one `identifier` (a digit-leading,
; letter-containing, dot-free token); a pure number stays `integer`.
(field_value (integer)        @value.integer)
(field_value (version)        @value.version)
(field_value (iso_date)       @value.date)
(field_value (url)            @value.url)
(field_value (quoted_string)  @value.string)
(field_value (flag_token)     @value.flag)
(field_value (constraint_op)  @value.op)
; The standalone glob-all `*` (`packages: *`) is anonymous. Capture it so a
; regression that splits a glob and drops a stray `*` stays visible.
(field_value "*" @value.star)

; A qualified constraint target. One atomic token (see makeQualifiedNameRules), so the
; golden pins its exact text and span rather than two halves.
(field_value (qualified_name) @value.qualified)

; Stanza header: the keyword and, when present, its named target.
(stanza_header (keyword) @stanza.keyword)
(stanza_header name: (package_name) @stanza.package)
(stanza_header name: (repo_name)    @stanza.repo)

; Conditional predicates: the call fn/arg and each boolean-combinator atom.
(predicate_call
  fn: (identifier) @predicate.fn
  arg: (predicate_arg (identifier) @predicate.arg))
(if_clause   condition: (boolean) @if.condition)
(predicate_not (predicate_call fn: (identifier) @predicate.not.fn))

; Clause spans, so a change to where an if/elif/else body starts and ends shows up
; as a span diff rather than passing silently.
(if_clause) @clause.if
(elif_clause) @clause.elif
(else_clause) @clause.else
