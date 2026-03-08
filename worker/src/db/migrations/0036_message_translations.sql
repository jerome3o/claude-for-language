-- Add translation and segmentation columns to messages table
-- for interactive chat translations feature

ALTER TABLE messages ADD COLUMN translation TEXT;
ALTER TABLE messages ADD COLUMN segmentation TEXT;
