; Dispatch each dump section's body to the member grammar for its IL, keyed by
; the phase banner. The languages resolve at query/highlight time against
; installed parsers named ghc_core / ghc_stg / ghc_cmm (see each member's
; tree-sitter.json `injection-regex`). The banner regexes are mutually
; exclusive, so at most one applies per section.

((section
   (banner) @_banner
   (body) @injection.content)
 (#match? @_banner "(Tidy Core|Desugar|CorePrep|Core)")
 (#set! injection.language "ghc_core"))

((section
   (banner) @_banner
   (body) @injection.content)
 (#match? @_banner "STG")
 (#set! injection.language "ghc_stg"))

((section
   (banner) @_banner
   (body) @injection.content)
 (#match? @_banner "Cmm")
 (#set! injection.language "ghc_cmm"))
