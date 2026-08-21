-- Run these commands in the Vercel Storage > Data > Query Console

CREATE TABLE IF NOT EXISTS waitlist (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS alpha_requests (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(255) NOT NULL,
  company VARCHAR(255),
  social_url VARCHAR(255) NOT NULL,
  reason TEXT NOT NULL,
  agreed_nda BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(50) DEFAULT 'pending', -- pending, approved, rejected
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Rate limiting for public form submissions (waitlist, alpha requests) — reuses
-- the existing Postgres instance rather than adding a new service. One row per
-- accepted attempt; checked as a rolling window, never deleted (cheap to keep,
-- useful for abuse forensics later).
CREATE TABLE IF NOT EXISTS submission_log (
  id SERIAL PRIMARY KEY,
  ip VARCHAR(64) NOT NULL,
  action VARCHAR(50) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS submission_log_ip_action_idx ON submission_log (ip, action, created_at);
