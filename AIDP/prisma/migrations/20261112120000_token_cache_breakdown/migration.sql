-- The cached part of a call's input, and the part written into the cache.
--
-- Both are a breakdown of "inputTokens", not an addition to it: every provider
-- here reports its cached tokens inside the prompt count. They are stored apart
-- because they are billed apart — a cache read is a quarter to a half the price
-- of ordinary input, so two runs with identical "inputTokens" can differ in
-- cost by several times, and nothing already in this table could tell them
-- apart.
--
-- Backfilled to 0 rather than NULL. Every row written before this migration was
-- recorded by code that did not read the field, so "unknown" and "none" are the
-- same answer for them, and a NOT NULL default keeps the sums in the operator
-- console free of null handling.
ALTER TABLE "token_usage"
  ADD COLUMN "cachedTokens"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0;
