; Extraction contract for the extract-golden gate (test/runners/extract-golden.sh).

(proc name: (_) @proc.name)
(data_section name: (section_name) @data.section)

(label name: (_) @block.label)
(goto target: (identifier) @goto.target)
(returns_to target: (identifier) @return.target)
(cond_branch
  condition: (_) @branch.cond
  consequence: (identifier) @branch.then
  alternative: (identifier) @branch.else)
(switch scrutinee: (_) @switch.scrutinee)

(assignment lhs: (_) @assign.lhs rhs: (_) @assign.rhs)
(const_statement (_) @const.value)
(mem_access address: (_) @mem.address)

(call target: (_) @call.target)
(foreign_call_statement
  (call_convention) @foreign.conv
  target: (_) @foreign.target
  returns_to: (identifier) @foreign.returns)
(foreign_call
  (call_convention) @fcall.conv
  target: (_) @fcall.target)

(con_label) @clabel
(special) @stack.area
(machop) @machop
(cmm_type) @type

(caf_entry label: (identifier) @caf.label)
(caf_set (identifier) @caf.member)
