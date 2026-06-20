{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE MagicHash #-}
{-# LANGUAGE UnboxedTuples #-}
{-# LANGUAGE EmptyDataDecls #-}
{-# LANGUAGE StrictData #-}

-- Source for generated dump fixtures (see `just gen-corpus`). Strict and
-- {-# UNPACK #-}'d fields drive worker/wrapper splitting (the $w worker takes
-- the unboxed components, the wrapper rebuilds the box); a bang pattern pins a
-- strict accumulator, surfacing a demand signature in [IdInfo]; MagicHash +
-- UnboxedTuples bring in Int# arithmetic and a (# .. #) return, the levity /
-- RuntimeRep surface that -fprint-explicit-runtime-reps decorates; and an empty
-- data declaration plus a nullary constructor cover the zero-field cases.
module Strictness where

import GHC.Exts (Int (..), Int#, (+#))

-- Strict + UNPACKed fields: the wrapper unboxes both Ints into a $w worker.
data V2 = V2 {-# UNPACK #-} !Int {-# UNPACK #-} !Int

dot :: V2 -> V2 -> Int
dot (V2 a b) (V2 c d) = a * c + b * d

-- StrictData makes the first field strict implicitly; `~` opts the second back
-- out to lazy, so the two field demands differ.
data Box a = Box a ~(Maybe a)

unBox :: Box a -> a
unBox (Box x _) = x

-- Bang pattern: a strict left fold whose worker carries an explicit demand sig.
total :: [Int] -> Int
total = go 0
  where
    go !acc [] = acc
    go !acc (x : xs) = go (acc + x) xs

-- Unboxed primitives + an unboxed-tuple result: Int# arithmetic and a
-- (# Int#, Int# #) in Core, the representation/levity surface.
addPair :: Int -> Int -> (# Int#, Int# #)
addPair (I# x) (I# y) = (# x +# y, x #)

-- Empty data declaration: a nullary, constructor-less type.
data Empty

-- Nullary constructor alongside a strict unary one.
data Flag = Off | On !Bool

flip' :: Flag -> Flag
flip' Off = On True
flip' (On b) = On (not b)
