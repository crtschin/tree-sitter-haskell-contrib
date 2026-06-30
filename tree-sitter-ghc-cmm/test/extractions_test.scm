; Extraction contract for the extract-golden gate (test/runners/extract-golden.sh).
; Captures the semantic payload each Cmm dump exposes, so the golden asserts
; both shape and the exact extracted text (not merely absence of ERROR nodes).

; ---- top-level definitions ----
(proc name: (_) @proc.name)
(data_section name: (section_name) @data.section)

; ---- control-flow labels ----
(label name: (_) @block.label)
(goto target: (identifier) @goto.target)
(returns_to target: (identifier) @return.target)
(cond_branch
  condition: (_) @branch.cond
  consequence: (identifier) @branch.then
  alternative: (identifier) @branch.else)
(switch scrutinee: (_) @switch.scrutinee)

; ---- statements ----
(assignment lhs: (_) @assign.lhs rhs: (_) @assign.rhs)
(const_statement (_) @const.value)
(mem_access address: (_) @mem.address)

; ---- foreign / lowered calls ----
; A call's target is one node in every form: a name, a label, or the
; `indirect_target` wrapper for a computed address (`call (I64[Sp])(...)`).
(call target: (_) @call.target)
(foreign_call_statement
  (call_convention) @foreign.conv
  target: (_) @foreign.target
  returns_to: (identifier) @foreign.returns)
; The assignment-rhs ccall form `(_c1::F64) = call "ccall" .. sqrt(D1)`, distinct
; from the `call` statement (no args:/res:/upd: trailer) and from the high-level
; `foreign call` statement.
(foreign_call
  (call_convention) @fcall.conv
  target: (_) @fcall.target)

; ---- names & leaf payloads ----
(con_label) @clabel
(special) @stack.area
(machop) @machop
(cmm_type) @type

; ---- CAF analysis (-ddump-cmm-caf) ----
(caf_entry label: (identifier) @caf.label)
(caf_set (identifier) @caf.member)
