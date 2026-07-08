; Extraction contract for the extract-golden gate (test/runners/extract-golden.sh).
; Captures the semantic payload each record must expose, so the golden asserts
; both shape and the exact extracted text (not merely absence of ERROR nodes).

(rule_firing
  name: (rule_name) @rule.name
  provenance: (provenance (module) @rule.module))

(rule_firing
  name: (rule_name) @rule.name
  provenance: (provenance (builtin) @rule.builtin))

; A firing may print without an origin. Assert the name is captured whole.
(rule_firing
  name: (rule_name) @rule.name
  .)

(inlining name: (inlined_id) @inline.id)

(inlining detail: (detail) @inline.detail)
