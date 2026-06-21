; GHC STG dump rainbow brackets.

[ "(" ")" "[" "]" "{" "}" "(#" "#)" ] @rainbow.bracket

; Nodes that open a new nesting level.
[
  (arg_list)
  (stg_arg_list)
  (free_vars)
  (rec_block)
  (tagged_binder)
  (let)
  (let_no_escape)
  (case)
  (type_paren_form)
  (type_list)
  (unboxed_type)
] @rainbow.scope
