{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE MagicHash #-}
{-# LANGUAGE UnboxedTuples #-}
{-# LANGUAGE EmptyDataDecls #-}
{-# LANGUAGE StrictData #-}

-- Worker/wrapper splits, demand signatures, Int# arithmetic, an unboxed tuple
-- for -fprint-explicit-runtime-reps, and types with zero fields.
module Strictness where

import GHC.Exts (Int (..), Int#, (+#))

data V2 = V2 {-# UNPACK #-} !Int {-# UNPACK #-} !Int

dot :: V2 -> V2 -> Int
dot (V2 a b) (V2 c d) = a * c + b * d

-- Under StrictData, `~` makes the second field lazy, so the two field demands
-- differ.
data Box a = Box a ~(Maybe a)

unBox :: Box a -> a
unBox (Box x _) = x

total :: [Int] -> Int
total = go 0
  where
    go !acc [] = acc
    go !acc (x : xs) = go (acc + x) xs

addPair :: Int -> Int -> (# Int#, Int# #)
addPair (I# x) (I# y) = (# x +# y, x #)

data Empty

data Flag = Off | On !Bool

flip' :: Flag -> Flag
flip' Off = On True
flip' (On b) = On (not b)
