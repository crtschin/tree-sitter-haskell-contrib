; Extraction contract for the extract-golden gate (test/runners/extract-golden.sh).
; Captures the semantic payload each STG record must expose, so the golden asserts
; both shape and the exact extracted text (not merely absence of ERROR nodes).

; ---- top-level binding names, signatures, and rhs kinds ----
(binding name: (variable) @bind.name)
; Upper-led bound Id (data-con worker/wrapper, MkW_F, T24806.Tup2) — the whole
; qualified con name, not a truncated head.
(binding name: (constructor) @bind.con-name)
; GHC's synthesized program entry, printed with a leading `:` (`:Main.main`).
(binding name: (entry_name) @bind.entry)
(binding type: (constructor) @bind.type)
(binding rhs: (literal) @bind.literal)

; Tag-inferred binders (CodeGenAnal STG): name plus the <Tag...> annotation.
(tagged_binder
  name: (variable) @binder.name
  (tag) @binder.tag)
; Upper-led tag-inferred binder (data-con worker, e.g. (Main.Res, <TagProper>)).
(tagged_binder
  name: (constructor) @binder.con-name
  (tag) @binder.con-tag)
; Occurrence-annotated binder on a case alt, e.g. ipv6 [Occ=Dead] — assert the
; whole [Occ=..] note (incl. the Once1! variant) is captured, not clipped.
(annotated_binder (binder_annotation) @binder.occ)

; ---- closures: update flag (\r \u \s \j), cost-centre, free vars ----
(closure (update_flag) @closure.update)
(closure (cost_centre) @closure.ccs)
(closure (free_vars (variable) @closure.freevar))

; ---- data-constructor allocation: con name + cost-centre profile ----
; StgRhsCon `Con! [args]`: the con head must be captured WHOLE, with the
; saturation `!` split off — never munched into the name. The cost-centre is
; suppressed in most passes, so capture it separately rather than gating the
; con head on its presence.
(con_app_rhs (constructor) @con.name)
(con_app_rhs (cost_centre) @con.ccs)
(con_or_op_app (constructor) @con.name)
; The operator (GHC.Generics.:*:!) and bare `:` (:! [x xs]) StgRhsCon heads.
(con_app_rhs (con_operator) @con.op)
(con_app_rhs (special_con) @con.special)
; Qualified `:`-led con operator in StgConApp position (GHC.Generics.:*: [a b]).
(con_or_op_app (con_operator) @con.op)
; Operator-named StgApp head (a symbolic class method, GHC.Num.* d a b).
(app (operator) @app.op)
; Foreign-call target of an StgOpApp over a static ccall (base:performMajorGC).
(foreign_call target: (variable) @ffi.target)

; ---- case: scrutinee, case binder, and alternative patterns ----
(case
  scrutinee: (variable) @case.scrutinee
  binder: (variable) @case.binder)
(alternative pattern: (constructor) @alt.pattern)
(alternative pattern: "__DEFAULT" @alt.default)

; Tag-checked occurrence in an alt body, e.g. wild<TagVal[TagEPT]>.
(tagged_occurrence) @occ.tagged

; Source-note tick prefixing an expression, e.g. src<file:1:1-2>.
(tick_expr (tickish) @tick)
