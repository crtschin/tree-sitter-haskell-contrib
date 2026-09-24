[
  (let)
  (let_no_escape)
  (case)
  (alternative)
  (closure)
  (rec_block)
] @local.scope

; `function` matches the binding-name capture in highlights.scm.
(binding name: (variable) @local.definition.function)
(tagged_binder name: (variable) @local.definition.function)

(case binder: (variable) @local.definition.variable)
(case binder: (annotated_binder (variable) @local.definition.variable))

(arg_list (variable) @local.definition.variable.parameter)
(arg_list (annotated_binder (variable) @local.definition.variable.parameter))
(arg_list (tagged_binder name: (variable) @local.definition.variable.parameter))

; A bare-variable rhs also matches, because the rhs is a direct child too. Its
; only occurrence is itself, so the extra definition is harmless.
(alternative (variable) @local.definition.variable)

(variable) @local.reference
