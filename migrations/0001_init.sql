CREATE TABLE tickers (
  symbol TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'opht'
);
CREATE TABLE price_history (
  symbol TEXT NOT NULL,
  date TEXT NOT NULL,
  adj_close REAL NOT NULL,
  PRIMARY KEY (symbol, date)
);
CREATE TABLE market_caps (
  symbol TEXT PRIMARY KEY,
  market_cap REAL,
  last_updated TEXT
);
CREATE TABLE data_status (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT
);
