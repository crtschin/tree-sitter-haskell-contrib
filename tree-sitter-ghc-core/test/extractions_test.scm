; Extraction contract for the extract-golden gate (test/runners/extract-golden.sh).
; Captures a binding's semantic payload (binder, signature, rhs) plus the
; field-bearing expression forms, so the golden asserts the exact extracted
; text and span, not merely the absence of ERROR nodes.

; A top-level binding: its binder name, optional type signature, and rhs shape.
(binding
  name: (variable) @binding.name
  rhs: (_) @binding.rhs)

(binding
  signature: (type_signature) @binding.signature)

; Operator-named binders print inside parens. Capture the bare operator.
(binding
  name: (paren_operator (operator) @binding.operator))

; case scrutinee and (when -dsuppress-* leaves it) the case binder.
(case scrutinee: (_) @case.scrutinee)
(case binder: (variable) @case.binder)

; let/letrec/join tag and its body expression.
(let kind: _ @let.kind body: (_) @let.body)

; A join-point tail call: the target atom right after `jump` (join points have
; no field, so capture the first child positionally).
(jump . (_) @jump.target)

; An unboxed tuple `(# .. #)` — assert the bracket-bounded span, not a mis-split.
(unboxed_tuple) @unboxed.tuple

; A foreign call exposes its C target and full argument type.
(foreign_call target: (_) @ffi.target)
(foreign_call type: (_) @ffi.type)

; Leaf payloads inside an rhs: constructor names and literal values.
(application (constructor) @app.constructor)
(literal) @literal
