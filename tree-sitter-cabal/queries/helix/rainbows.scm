; cabal rainbow brackets. Only conditional predicates expose named bracket
; nodes; brackets inside field values are anonymous tokens with no container,
; so they are left to highlights.scm.

[ "(" ")" ] @rainbow.bracket

[ (predicate_paren) (predicate_call) ] @rainbow.scope
