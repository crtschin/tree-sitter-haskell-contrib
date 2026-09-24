; Only predicates have named bracket nodes. A bracket in a field value has no
; container node, so highlights.scm colors it.

[ "(" ")" ] @rainbow.bracket

[ (predicate_paren) (predicate_call) ] @rainbow.scope
