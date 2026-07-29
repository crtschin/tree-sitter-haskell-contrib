; Extraction contract for the extract-golden gate (test/runners/extract-golden.sh).
; Asserts the grammar pulls out the semantic payload of a .cabal file with the
; exact text and span, not merely that no ERROR node appears.

; The cabal-version directive.
(cabal_version (spec_version) @cabal.version)

; Field names, and each meaningful value leaf split by kind so a mis-split of a
; build-depends list (package vs constraint vs version) fails the diff.
; Via the labelled fields, so dropping either label fails the gate. `value` is one
; node spanning every continuation line, which pins the layout rule: a regression
; that reopened an indent block per value line would split it.
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

; Section headers: kind (library/executable/...) and optional name.
(_ type: (section_type) @section.type name: (section_name) @section.name)
(library type: (section_type) @section.type . (property_or_conditional_block))

; Conditional predicates: the function (e.g. flag/impl/os) and its argument.
; impl(ghc >= 9.4) carries a constraint_op and version inside the arg. Capture
; those too so a mis-split of a compiler-version predicate fails the diff.
(predicate_call
  fn: (identifier) @predicate.fn
  arg: (predicate_arg (identifier) @predicate.arg))
(predicate_arg (constraint_op) @predicate.constraint)
(predicate_arg (version) @predicate.version)

; Clause spans, so a change to where an if/elif/else body starts and ends shows up
; as a span diff rather than passing silently.
(if_clause) @clause.if
(elif_clause) @clause.elif
(else_clause) @clause.else
