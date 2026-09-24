{-# LANGUAGE ForeignFunctionInterface #-}

-- Foreign imports become Core `{__ffi_static_ccall_..}` calls and Cmm foreign
-- calls. The foreign export adds a Core export wrapper.
module Ffi where

import Foreign.C.Types (CDouble (..), CInt (..))

foreign import ccall unsafe "math.h sqrt"
  c_sqrt :: CDouble -> CDouble

-- A safe ccall prints differently in Core.
foreign import ccall safe "math.h pow"
  c_pow :: CDouble -> CDouble -> CDouble

hypot' :: CDouble -> CDouble -> CDouble
hypot' x y = c_sqrt (c_pow x 2 + c_pow y 2)

foreign export ccall "haskell_succ" haskellSucc :: CInt -> CInt

haskellSucc :: CInt -> CInt
haskellSucc n = n + 1
