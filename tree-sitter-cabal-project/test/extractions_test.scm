; Extraction contract for the extract-golden gate (test/runners/extract-golden.sh).
; Captures the semantic payload a cabal.project exposes: field name/value splits,
; package globs, constraint atoms, stanza headers, and conditional predicates.
; The golden asserts exact extracted text, not merely absence of ERROR nodes.

; Field name plus each leaf value token, so a value mis-split shows up as a span.
(field name: (field_name) @field.name)
(field_value (identifier)     @value.identifier)
(field_value (path)           @value.path)
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

; A qualified constraint target keeps package and sublibrary as distinct fields.
(qualified_name
  package: (package_name)       @qualified.package
  sublibrary: (sublibrary_name) @qualified.sublibrary)

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
