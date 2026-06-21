; GHC Cmm dump rainbow brackets.

[ "(" ")" "[" "]" "{" "}" "{offset" ] @rainbow.bracket

; Nodes that open a new nesting level.
[
  (parens)
  (machop_call)
  (mem_access)
  (proc)
  (offset_body)
  (data_section)
  (info_table)
  (switch)
  (switch_case)
  (cmm_group)
  (caf_env)
  (caf_entry)
  (caf_set)
] @rainbow.scope
