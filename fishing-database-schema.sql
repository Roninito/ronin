
-- Fishing Database Schema
-- Stores comprehensive information about North American fish species

CREATE TABLE IF NOT EXISTS fish (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  binomial TEXT NOT NULL,
  aliases TEXT, -- JSON array of alternative names
  lifecycle TEXT, -- Lifecycle information
  habitats TEXT, -- JSON array of habitats
  habits TEXT, -- Behavioral habits
  fishing_tips TEXT, -- Fishing tips and techniques
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_fish_name ON fish(name);
CREATE INDEX IF NOT EXISTS idx_fish_binomial ON fish(binomial);

-- Create SQL schema file for reference
