; Core bindings as symbols for the picker.
(binding name: (variable) @name) @definition.function
(binding name: (paren_operator (operator) @name)) @definition.function
; CorePrep emits nullary data-con workers under their constructor name
; (`Red :: Color` / `Red = Red`), so the binder is a constructor, not a variable.
(binding name: (constructor) @name) @definition.function
