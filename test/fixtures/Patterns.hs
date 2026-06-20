{-# LANGUAGE PatternSynonyms #-}
{-# LANGUAGE ViewPatterns #-}

-- Source for generated dump fixtures (see `just gen-corpus`). Pattern synonyms
-- desugar to builder ($b) and matcher ($m) bindings; view patterns and pattern
-- guards desugar to nested `case` scrutinising a function application -- Core
-- control-flow shapes the straight-line fixtures don't produce.
module Patterns where

-- Bidirectional pattern synonym: emits both a matcher and a builder in Core.
pattern Pair :: a -> b -> (a, b)
pattern Pair x y = (x, y)

swap' :: (a, b) -> (b, a)
swap' (Pair x y) = Pair y x

-- Unidirectional (matcher-only) pattern synonym over a cons view.
pattern Head :: a -> [a]
pattern Head x <- (x : _)

firstOr :: a -> [a] -> a
firstOr d [] = d
firstOr _ (Head x) = x

-- View pattern: desugars to `case parseDigit c of Just n -> ..`.
parseDigit :: Char -> Maybe Int
parseDigit c
  | c >= '0', c <= '9' = Just (fromEnum c - fromEnum '0')
  | otherwise = Nothing

classify :: Char -> Int
classify (parseDigit -> Just n) = n
classify _ = -1

-- Pattern guard (`| Just v <- ..`): a guard that binds via a nested case.
lookupDef :: Eq k => k -> v -> [(k, v)] -> v
lookupDef k def kvs
  | Just v <- lookup k kvs = v
  | otherwise = def
