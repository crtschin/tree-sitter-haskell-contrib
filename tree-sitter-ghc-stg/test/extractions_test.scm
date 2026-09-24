; Extraction contract for the extract-golden gate (test/runners/extract-golden.sh).

(binding name: (variable) @bind.name)
; An upper-led Id, e.g. `T24806.Tup2`, must capture the whole qualified name.
(binding name: (constructor) @bind.con-name)
(binding name: (entry_name) @bind.entry)
(binding type: (constructor) @bind.type)
(binding rhs: (literal) @bind.literal)

(tagged_binder
  name: (variable) @binder.name
  (tag) @binder.tag)
(tagged_binder
  name: (constructor) @binder.con-name
  (tag) @binder.con-tag)
; The whole `[Occ=..]` note must survive, `Once1!` included.
(annotated_binder (binder_annotation) @binder.occ)

(closure (update_flag) @closure.update)
(closure (cost_centre) @closure.ccs)
(closure (free_vars (variable) @closure.freevar))

; The con head must come out whole, with the `!` split off. Most passes omit
; the cost-centre, so a separate pattern captures it.
(con_app_rhs (constructor) @con.name)
(con_app_rhs (cost_centre) @con.ccs)
(con_or_op_app (constructor) @con.name)
(con_app_rhs (con_operator) @con.op)
(con_app_rhs (special_con) @con.special)
(con_or_op_app (con_operator) @con.op)
(app (operator) @app.op)
(foreign_call target: (variable) @ffi.target)

(case
  scrutinee: (variable) @case.scrutinee
  binder: (variable) @case.binder)
(alternative pattern: (constructor) @alt.pattern)
(alternative pattern: "__DEFAULT" @alt.default)

(tagged_occurrence) @occ.tagged

(tick_expr (tickish) @tick)
