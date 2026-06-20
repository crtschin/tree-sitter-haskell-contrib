{-# LANGUAGE ForeignFunctionInterface #-}

-- Source for generated dump fixtures (see `just gen-corpus`). A foreign import
-- lowers to a Core `foreign_call` ({__ffi_static_ccall_..}); the Cmm dump shows
-- the matching foreign-call sequence, and `foreign export` makes GHC emit a C
-- wrapper stub plus a Core export wrapper.
module Ffi where

import Foreign.C.Types (CDouble (..), CInt (..))

-- Pure unsafe ccall.
foreign import ccall unsafe "math.h sqrt"
  c_sqrt :: CDouble -> CDouble

-- Safe ccall (a different FCall flavour in Core).
foreign import ccall safe "math.h pow"
  c_pow :: CDouble -> CDouble -> CDouble

hypot' :: CDouble -> CDouble -> CDouble
hypot' x y = c_sqrt (c_pow x 2 + c_pow y 2)

-- foreign export: emits a C stub + a Core export wrapper for haskellSucc.
foreign export ccall "haskell_succ" haskellSucc :: CInt -> CInt

haskellSucc :: CInt -> CInt
haskellSucc n = n + 1
