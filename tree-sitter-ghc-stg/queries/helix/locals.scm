; GHC STG dump scope tracking. Resolved references inherit the definition's
; highlight class, linking closure parameters and bound names to their uses.

; ---- scopes ----
[
  (let)
  (let_no_escape)
  (case)
  (alternative)
  (closure)
  (rec_block)
] @local.scope

; ---- definitions ----
; `function` matches highlights.scm's binding-name treatment.
(binding name: (variable) @local.definition.function)
(tagged_binder name: (variable) @local.definition.function)

(case binder: (variable) @local.definition.variable)
(case binder: (annotated_binder (variable) @local.definition.variable))

; arg_list holds only binders, so these captures are unambiguous.
(arg_list (variable) @local.definition.variable.parameter)
(arg_list (annotated_binder (variable) @local.definition.variable.parameter))
(arg_list (tagged_binder name: (variable) @local.definition.variable.parameter))

; alternative lists its binders as direct children with the rhs in a field, so a
; bare-variable rhs (rare) also matches here. Harmless: its own sole occurrence.
(alternative (variable) @local.definition.variable)

; ---- references (free_vars occurrences are references to outer binders) ----
(variable) @local.reference
