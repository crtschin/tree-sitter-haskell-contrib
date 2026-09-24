(proc) @local.scope

(label name: (identifier) @local.definition.label)
(label name: (con_label) @local.definition.label)

(goto target: (identifier) @local.reference)
(cond_branch consequence: (identifier) @local.reference)
(cond_branch alternative: (identifier) @local.reference)
(returns_to target: (identifier) @local.reference)
