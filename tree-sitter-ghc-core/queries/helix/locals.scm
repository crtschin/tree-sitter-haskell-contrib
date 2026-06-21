; GHC Core dump scope tracking. Resolved references inherit the definition's
; highlight class, so a let-bound name's use sites pick up @function and
; pattern/lambda binders link to their uses.

; ---- scopes ----
[
  (lambda)
  (let)
  (case)
  (case_as_let)
  (alternative)
] @local.scope

; ---- definitions ----
; let/letrec/join and top-level binders; `function` matches highlights.scm.
(binding name: (variable) @local.definition.function)

(case binder: (variable) @local.definition.variable)
(case binder: (annotated_binder (variable) @local.definition.variable))

; Alternative binders nest inside con_pattern/tuple_pattern (separate from rhs).
(con_pattern (variable) @local.definition.variable)
(con_pattern (annotated_binder (variable) @local.definition.variable))
(con_pattern (typed_binder (variable) @local.definition.variable))
(tuple_pattern (variable) @local.definition.variable)
(tuple_pattern (annotated_binder (variable) @local.definition.variable))

; Lambda has no binder/body field, so a bare-variable body (rare) also matches
; here and is coloured as a parameter. Harmless: it is its own sole occurrence.
(lambda (variable) @local.definition.variable.parameter)
(lambda (annotated_binder (variable) @local.definition.variable.parameter))
(lambda (typed_binder (variable) @local.definition.variable.parameter))

; ---- references ----
(variable) @local.reference
