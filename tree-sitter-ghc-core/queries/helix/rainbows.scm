; GHC Core dump rainbow brackets.

[ "(" ")" "[" "]" "{" "}" "(#" "#)" ] @rainbow.bracket

; Nodes that open a new nesting level.
[
  (parens)
  (tuple)
  (unboxed_tuple)
  (tuple_pattern)
  (paren_operator)
  (typed_binder)
  (type_binder)
  (foreign_call)
  (coercion)
  (type_paren_form)
  (type_list)
  (unboxed_type)
  (let)
  (case)
  (case_as_let)
] @rainbow.scope
