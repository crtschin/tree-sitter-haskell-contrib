; Extraction contract for the extract-golden gate (test/runners/extract-golden.sh).
; The golden asserts the exact text and span of each capture.

(binding
  name: (variable) @binding.name
  rhs: (_) @binding.rhs)

(binding
  signature: (type_signature) @binding.signature)

(binding
  name: (paren_operator (operator) @binding.operator))

(case scrutinee: (_) @case.scrutinee)
(case binder: (variable) @case.binder)

(let kind: _ @let.kind body: (_) @let.body)

; `jump` has no field, so the anchor captures its first child.
(jump . (_) @jump.target)

(unboxed_tuple) @unboxed.tuple

(foreign_call target: (_) @ffi.target)
(foreign_call type: (_) @ffi.type)

(application (constructor) @app.constructor)
(literal) @literal
