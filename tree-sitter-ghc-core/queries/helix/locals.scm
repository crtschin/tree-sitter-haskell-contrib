; A resolved reference takes the highlight of its definition.

[
  (lambda)
  (let)
  (case)
  (case_as_let)
  (alternative)
] @local.scope

; The `function` kind matches the binding highlight in highlights.scm.
(binding name: (variable) @local.definition.function)

(case binder: (variable) @local.definition.variable)
(case binder: (annotated_binder (variable) @local.definition.variable))

(con_pattern (variable) @local.definition.variable)
(con_pattern (annotated_binder (variable) @local.definition.variable))
(con_pattern (typed_binder (variable) @local.definition.variable))
(tuple_pattern (variable) @local.definition.variable)
(tuple_pattern (annotated_binder (variable) @local.definition.variable))

; Lambda has no binder or body field, so a bare-variable body also matches as a
; parameter. That variable is its own sole occurrence, so the wrong color is
; harmless.
(lambda (variable) @local.definition.variable.parameter)
(lambda (annotated_binder (variable) @local.definition.variable.parameter))
(lambda (typed_binder (variable) @local.definition.variable.parameter))

(variable) @local.reference
