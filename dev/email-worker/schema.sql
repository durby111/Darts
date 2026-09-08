CREATE TABLE IF NOT EXISTS email_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL CHECK (count >= 0),
  expires INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS email_limits_expiry ON email_limits(expires);
