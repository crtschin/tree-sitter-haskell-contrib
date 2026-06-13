; GHC Cmm dump highlighting (compiler/GHC/Cmm/Node.hs / Expr.hs surface).

; ---- names (generic, specialized below) ----
(identifier) @variable
(con_label) @constructor

; Hardware / abstract machine registers and stack areas.
((identifier) @variable.builtin
  (#match? @variable.builtin "^(Sp|SpLim|Hp|HpLim|HpAlloc|CCCS|BaseReg|MachSp|old|R[0-9]+|F[0-9]+|D[0-9]+|L[0-9]+|XMM[0-9]+|YMM[0-9]+|ZMM[0-9]+)$"))
(special) @variable.builtin

; ---- types, machine ops, literals ----
(cmm_type) @type.builtin
(machop) @function.builtin
(literal) @constant.numeric
(section_name) @string

; ---- comments / banners / metadata ----
(comment) @comment
(banner) @comment.documentation
; info-table + static-info blocks are pretty-printer metadata.
(info_table) @attribute
(static_info) @attribute

; ---- procs and labels ----
(proc name: (identifier) @function)
(label name: (identifier) @label)
(goto target: (identifier) @label)
(cond_branch consequence: (identifier) @label)
(cond_branch alternative: (identifier) @label)
(returns_to target: (identifier) @label)

; ---- keywords ----
[
  "goto"
  "if"
  "else"
] @keyword.control.conditional

[
  "switch"
  "case"
  "default"
  "call"
  "returns"
  "to"
] @keyword.control

[
  "const"
  "section"
  "{offset"
] @keyword

[
  "args:"
  "res:"
  "upd:"
  "likely:"
] @keyword.directive

(likely [ "True" "False" ] @constant.builtin.boolean)

; ---- operators ----
(binop) @operator

[
  "="
  "::"
  "!"
  ".."
] @operator

; ---- punctuation ----
[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
] @punctuation.bracket

[
  ","
  ";"
  ":"
] @punctuation.delimiter
