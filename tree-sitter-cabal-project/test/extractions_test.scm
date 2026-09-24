; Extraction contract for test/runners/extract-golden.sh. The golden pins the
; exact text and span of each capture.

; `value` is one node across every continuation line, which pins the layout
; rule.
(field name: (field_name) @field.name)
(field value: (field_value) @field.value)
(field_value (identifier)     @value.identifier)
(field_value (path)           @value.path)
(field_value (text_fragment)  @value.text)
(field_value (boolean)        @value.boolean)
(field_value (integer)        @value.integer)
(field_value (version)        @value.version)
(field_value (iso_date)       @value.date)
(field_value (url)            @value.url)
(field_value (quoted_string)  @value.string)
(field_value (flag_token)     @value.flag)
(field_value (constraint_op)  @value.op)
; The glob-all `*` is anonymous, so a dropped `*` needs its own capture.
(field_value "*" @value.star)

(field_value (qualified_name) @value.qualified)

(stanza_header (keyword) @stanza.keyword)
(stanza_header name: (package_name) @stanza.package)
(stanza_header name: (repo_name)    @stanza.repo)

(predicate_call
  fn: (identifier) @predicate.fn
  arg: (predicate_arg (identifier) @predicate.arg))
(if_clause   condition: (boolean) @if.condition)
(predicate_not (predicate_call fn: (identifier) @predicate.not.fn))

(if_clause) @clause.if
(elif_clause) @clause.elif
(else_clause) @clause.else
