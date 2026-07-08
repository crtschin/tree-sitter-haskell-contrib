; Extraction contract for the extract-golden gate (test/runners/extract-golden.sh).
; This is the CONTAINER grammar: it splits a multi-IL dump stream into
; banner-delimited sections with opaque bodies. The golden asserts the split
; boundaries and that each section's banner text names the right IL, so a
; mis-split (wrong span) or a dropped banner fails the diff, not just ERRORs.

; Each section pairs its phase banner (the text picks the injected member
; grammar) with its opaque body. Multi-line body captures are span-only.
(section
  (banner) @section.banner
  (body) @section.body) @section

; A banner with an empty body still parses as a section. Assert the banner alone.
(section
  (banner) @section.banner
  .) @section

; Preamble before the first banner is a bare body at file scope, not a section.
(source_file
  (body) @preamble.body)
