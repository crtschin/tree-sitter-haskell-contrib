; Extraction contract for test/runners/extract-golden.sh. The golden pins the
; section boundaries and the banner of each section.

; A multi-line body capture records only its span.
(section
  (banner) @section.banner
  (body) @section.body) @section

(section
  (banner) @section.banner
  .) @section

(source_file
  (body) @preamble.body)
