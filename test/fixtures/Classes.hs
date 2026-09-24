{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE FunctionalDependencies #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}

-- Instance dictionaries from a functional dependency, stock deriving, and
-- newtype deriving.
module Classes where

class Collection c e | c -> e where
  cinsert :: e -> c -> c
  cempty :: c

newtype IntStack = IntStack [Int]

instance Collection IntStack Int where
  cinsert x (IntStack xs) = IntStack (x : xs)
  cempty = IntStack []

build :: IntStack
build = cinsert (1 :: Int) (cinsert 2 cempty)

data Colour = Red | Green | Blue
  deriving (Eq, Ord, Show, Enum, Bounded)

spectrum :: [Colour]
spectrum = [minBound .. maxBound]

data Point = Point {px :: Int, py :: Int}
  deriving (Eq, Show)

-- $fNumMetres coerces the Num Double dictionary.
newtype Metres = Metres Double
  deriving (Eq, Ord, Show, Num, Fractional)

stride :: Metres -> Metres
stride m = m + Metres 1

-- Core prints `/` in prefix position, where it collides with the `/` lambda
-- head the GHC testsuite normaliser produces.
halve :: Metres -> Metres
halve m = m / 2
