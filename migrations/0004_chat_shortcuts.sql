-- Separate from likes so feedback updates never overwrite custom chat shortcuts.
ALTER TABLE consumer_users ADD COLUMN chat_shortcuts TEXT;
