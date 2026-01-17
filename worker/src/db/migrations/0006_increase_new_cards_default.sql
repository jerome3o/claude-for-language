-- Increase default new cards per day from 20 to 30
UPDATE decks SET new_cards_per_day = 30 WHERE new_cards_per_day = 20;
