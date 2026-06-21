; GHC Cmm dump scope tracking. A block label is defined once per proc and
; referenced by the jumps within it.

(proc) @local.scope

; ---- definitions ----
(label name: (identifier) @local.definition.label)
(label name: (con_label) @local.definition.label)

; ---- references (jump targets) ----
(goto target: (identifier) @local.reference)
(cond_branch consequence: (identifier) @local.reference)
(cond_branch alternative: (identifier) @local.reference)
(returns_to target: (identifier) @local.reference)
