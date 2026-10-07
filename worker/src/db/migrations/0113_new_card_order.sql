-- "Order new cards by" (Settings → New cards; shared/decks/new-card-order.ts): which
-- brand-new words the daily budget introduces first. JSON NewCardOrder (four booleans:
-- new_characters_first, new_words_first, most_common_first, sentences_last), NULL = defaults.
ALTER TABLE users ADD COLUMN new_card_order TEXT;
