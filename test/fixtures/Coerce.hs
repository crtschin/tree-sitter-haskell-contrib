{-# LANGUAGE GADTs #-}
{-# LANGUAGE TypeFamilies #-}

-- Casts from newtypes and `coerce`, type-family axioms, and GADT equality
-- evidence.
module Coerce where

import Data.Coerce (coerce)

newtype Age = Age Int

inc :: Age -> Age
inc (Age n) = Age (n + 1)

ages :: [Int] -> [Age]
ages = coerce

type family F a where
  F Int = Bool
  F Bool = Int

data G a where
  GI :: Int -> G Int
  GB :: Bool -> G Bool

evalG :: G a -> a
evalG (GI n) = n
evalG (GB b) = b

-- Each alternative refines `a`, so `eval` gets equality coercions that G does
-- not produce.
data Expr a where
  IntLit :: Int -> Expr Int
  BoolLit :: Bool -> Expr Bool
  Add :: Expr Int -> Expr Int -> Expr Int
  If :: Expr Bool -> Expr a -> Expr a -> Expr a

eval :: Expr a -> a
eval (IntLit n) = n
eval (BoolLit b) = b
eval (Add x y) = eval x + eval y
eval (If c t e) = if eval c then eval t else eval e
