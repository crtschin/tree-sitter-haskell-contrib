; Extraction contract for test/runners/extract-golden.sh. The golden pins the
; exact text and span of each capture.

(cabal_version (spec_version) @cabal.version)

; `value` is one node across every continuation line, so a regression that
; opens an indent block per line splits it. Each leaf kind has its own capture,
; so a mis-split of a build-depends list fails the diff.
(field name: (field_name) @field.name)
(field value: (field_value) @field.value)

(field_value (identifier) @value.identifier)
(field_value (module_name) @value.module)
(field_value (qualified_name) @value.qualified)
(field_value (version) @value.version)
(field_value (boolean) @value.bool)
(field_value (flag_token) @value.flag)
(field_value (url) @value.url)
(field_value (constraint_op) @value.constraint)
(field_value (path) @value.path)
(field_value (text_fragment) @value.text)
(field_value (quoted_string) @value.string)
(field_value (iso_date) @value.date)
(field_value (integer) @value.integer)

; With no keyword split, these spans move to @value.identifier.
(field_value (renaming_keyword) @value.renaming)

(_ type: (section_type) @section.type name: (section_name) @section.name)
(library type: (section_type) @section.type . (property_or_conditional_block))

(predicate_call
  fn: (identifier) @predicate.fn
  arg: (predicate_arg (identifier) @predicate.arg))
(predicate_arg (constraint_op) @predicate.constraint)
(predicate_arg (version) @predicate.version)

(if_clause) @clause.if
(elif_clause) @clause.elif
(else_clause) @clause.else
