{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE FunctionalDependencies #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}

-- Source for generated dump fixtures (see `just gen-corpus`). A functional
-- dependency (c -> e) fixes the determined type during dictionary
-- construction; the deriving clauses emit stock instance dictionaries
-- ($fEq.., $fShow.., $fOrd.., ..) and their method bindings, and the newtype
-- deriving builds its dictionary by coercing the underlying one.
module Classes where

-- Multi-param class with a functional dependency: c determines e.
class Collection c e | c -> e where
  cinsert :: e -> c -> c
  cempty :: c

newtype IntStack = IntStack [Int]

instance Collection IntStack Int where
  cinsert x (IntStack xs) = IntStack (x : xs)
  cempty = IntStack []

build :: IntStack
build = cinsert (1 :: Int) (cinsert 2 cempty)

-- Stock deriving across the common classes: $fShow/$fEq/$fOrd/$fEnum/$fBounded.
data Colour = Red | Green | Blue
  deriving (Eq, Ord, Show, Enum, Bounded)

spectrum :: [Colour]
spectrum = [minBound .. maxBound]

-- Record deriving: field-projecting Show/Eq dictionaries.
data Point = Point {px :: Int, py :: Int}
  deriving (Eq, Show)

-- Newtype deriving: $fNumMetres reuses Num Double via a representation coercion.
newtype Metres = Metres Double
  deriving (Eq, Ord, Show, Num)

stride :: Metres -> Metres
stride m = m + Metres 1
