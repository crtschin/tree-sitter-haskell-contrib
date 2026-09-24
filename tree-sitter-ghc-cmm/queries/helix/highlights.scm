; Generic names first. The specific patterns further down override them.
(identifier) @variable
(con_label) @constructor

((identifier) @variable.builtin
  (#match? @variable.builtin "^(Sp|SpLim|Hp|HpLim|HpAlloc|CCCS|BaseReg|MachSp|old|R[0-9]+|F[0-9]+|D[0-9]+|L[0-9]+|XMM[0-9]+|YMM[0-9]+|ZMM[0-9]+)$"))
(special) @variable.builtin

(cmm_type) @type.builtin
(machop) @function.builtin
(literal) @constant.numeric
(section_name) @string

(comment) @comment
(banner) @comment.documentation
(info_table) @attribute
(static_info) @attribute

(proc name: (identifier) @function)
(label name: (identifier) @label)
(goto target: (identifier) @label)
(cond_branch consequence: (identifier) @label)
(cond_branch alternative: (identifier) @label)
(returns_to target: (identifier) @label)

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

(binop) @operator

[
  "="
  "::"
  "!"
  ".."
] @operator

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
