(binding name: (variable) @name) @definition.function
(binding name: (paren_operator (operator) @name)) @definition.function
; CorePrep binds a nullary data-con worker under its constructor name, e.g.
; `Red = Red`.
(binding name: (constructor) @name) @definition.function
