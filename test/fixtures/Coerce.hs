{-# LANGUAGE GADTs #-}
{-# LANGUAGE TypeFamilies #-}

-- Source for generated Core fixtures (see `just gen-corpus`). Exercises the
-- coercion surface the simpler fixtures lack: newtype representation coercions
-- and `coerce` (casts), type-family axioms, and GADT equality evidence.
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

-- Richer GADT: a typed expression AST. Each alternative refines the index `a`,
-- so `eval` threads equality coercions (eq evidence / casts) through Core that
-- the two-constructor G never produces.
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
