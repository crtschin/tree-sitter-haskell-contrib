; cabal flag scope tracking. A `flag <name>` stanza defines a flag; a
; `flag(<name>)` predicate in a condition references it. No @local.scope: defs
; live in the implicit file-root scope, so a flag defined in one stanza resolves
; from any condition in the file.

(flag name: (section_name) @local.definition.variable)

(predicate_call
  fn: (identifier) @_fn
  arg: (predicate_arg (identifier) @local.reference)
  (#eq? @_fn "flag"))
