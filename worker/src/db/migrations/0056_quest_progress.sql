-- A breadcrumb for quest generation: which stage the world got to.
-- Generation is one long Claude call plus up to two repair rounds, so when a
-- quest fails or gets stuck this is what says where it stopped.

ALTER TABLE quests ADD COLUMN progress TEXT;
