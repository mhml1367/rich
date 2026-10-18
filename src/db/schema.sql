-- Fresh baseline. Every financial key is scoped to a room.
CREATE TABLE IF NOT EXISTS player_accounts (
  id uuid PRIMARY KEY,
  phone text NOT NULL UNIQUE CHECK (phone LIKE '+989%' AND length(phone)=13 AND substring(phone from 5) ~ '^[0-9]{9}$'),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS player_sessions (
  id uuid PRIMARY KEY,
  player_account_id uuid NOT NULL REFERENCES player_accounts(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS player_sessions_expiry_idx ON player_sessions(expires_at);
CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  mode text NOT NULL CHECK (mode IN ('solo','live','async')),
  scenario_id text NOT NULL CHECK (scenario_id IN ('recession','boom','high_inflation','market_shock')),
  turn_seconds integer NOT NULL CHECK (turn_seconds BETWEEN 30 AND 604800),
  invite_code text,
  max_players integer NOT NULL DEFAULT 4 CHECK (max_players BETWEEN 2 AND 8),
  bot_count integer NOT NULL DEFAULT 0 CHECK (bot_count BETWEEN 0 AND 6),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS invite_code text;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS max_players integer NOT NULL DEFAULT 4;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS bot_count integer NOT NULL DEFAULT 0;
UPDATE rooms SET invite_code=upper(substr(md5(random()::text || id::text),1,8)) WHERE invite_code IS NULL;
ALTER TABLE rooms ALTER COLUMN invite_code SET NOT NULL;
ALTER TABLE rooms ALTER COLUMN invite_code SET DEFAULT upper(substr(md5(random()::text),1,8));
CREATE UNIQUE INDEX IF NOT EXISTS rooms_invite_code_idx ON rooms(invite_code);
DO $$ BEGIN ALTER TABLE rooms ADD CONSTRAINT rooms_max_players_check CHECK (max_players BETWEEN 2 AND 8);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE rooms ADD CONSTRAINT rooms_bot_count_check CHECK (bot_count BETWEEN 0 AND 6);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS room_members (
  room_id uuid NOT NULL REFERENCES rooms(id), player_id uuid NOT NULL,
  player_account_id uuid REFERENCES player_accounts(id),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 40),
  token_hash text NOT NULL UNIQUE, joined_at timestamptz NOT NULL DEFAULT now(),
  is_bot boolean NOT NULL DEFAULT false,
  bot_style text CHECK (bot_style IS NULL OR bot_style IN ('conservative','entrepreneur','opportunist','consumer','analyst','balanced')),
  bot_difficulty text CHECK (bot_difficulty IS NULL OR bot_difficulty IN ('easy','normal','hard')),
  PRIMARY KEY (room_id, player_id)
);
ALTER TABLE room_members ADD COLUMN IF NOT EXISTS player_account_id uuid REFERENCES player_accounts(id);
ALTER TABLE room_members ADD COLUMN IF NOT EXISTS is_bot boolean NOT NULL DEFAULT false;
ALTER TABLE room_members ADD COLUMN IF NOT EXISTS bot_style text;
ALTER TABLE room_members ADD COLUMN IF NOT EXISTS bot_difficulty text;
ALTER TABLE room_members DROP CONSTRAINT IF EXISTS room_members_bot_style_check;
UPDATE room_members SET bot_style=CASE bot_style WHEN 'growth' THEN 'entrepreneur' WHEN 'defensive' THEN 'conservative' ELSE bot_style END
  WHERE bot_style IN ('growth','defensive');
ALTER TABLE room_members ADD CONSTRAINT room_members_bot_style_check CHECK (bot_style IS NULL OR bot_style IN ('conservative','entrepreneur','opportunist','consumer','analyst','balanced'));
DO $$ BEGIN
  ALTER TABLE room_members ADD CONSTRAINT room_members_bot_difficulty_check CHECK (bot_difficulty IS NULL OR bot_difficulty IN ('easy','normal','hard'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS room_turns (
  room_id uuid NOT NULL REFERENCES rooms(id),
  period_key text NOT NULL CHECK (period_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  deadline_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','settling','published')),
  published_at timestamptz,
  PRIMARY KEY (room_id, period_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS room_one_active_turn_idx ON room_turns(room_id) WHERE status IN ('open','settling');

CREATE TABLE IF NOT EXISTS economic_periods (
  room_id uuid NOT NULL REFERENCES rooms(id),
  period_key text NOT NULL CHECK (period_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  scenario_id text NOT NULL CHECK (scenario_id IN ('recession','boom','high_inflation','market_shock')),
  status text NOT NULL DEFAULT 'settling' CHECK (status IN ('settling','published')),
  settled_at timestamptz,
  PRIMARY KEY (room_id, period_key)
);
CREATE TABLE IF NOT EXISTS price_indices (
  room_id uuid NOT NULL, period_key text NOT NULL,
  category text NOT NULL CHECK (category IN ('food','housing','car','gold','currency','equipment','materials')),
  index_units bigint NOT NULL CHECK (index_units > 0),
  PRIMARY KEY (room_id, period_key, category),
  FOREIGN KEY (room_id, period_key) REFERENCES economic_periods(room_id, period_key)
);
CREATE TABLE IF NOT EXISTS economy_accounts (
  id uuid PRIMARY KEY, room_id uuid NOT NULL REFERENCES rooms(id),
  cash_tomans bigint NOT NULL DEFAULT 0 CHECK (cash_tomans >= 0),
  monthly_salary_tomans bigint NOT NULL DEFAULT 0 CHECK (monthly_salary_tomans >= 0),
  monthly_rent_tomans bigint NOT NULL DEFAULT 0 CHECK (monthly_rent_tomans >= 0),
  last_settled_period text,
  UNIQUE (id, room_id),
  FOREIGN KEY (room_id, last_settled_period) REFERENCES economic_periods(room_id, period_key)
);
CREATE TABLE IF NOT EXISTS investment_positions (
  room_id uuid NOT NULL, player_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('car','gold','currency','equipment','materials')),
  market_value_tomans bigint NOT NULL DEFAULT 0 CHECK (market_value_tomans >= 0),
  PRIMARY KEY (room_id, player_id, category),
  FOREIGN KEY (player_id, room_id) REFERENCES room_members(player_id, room_id)
);
CREATE TABLE IF NOT EXISTS player_decisions (
  room_id uuid NOT NULL, period_key text NOT NULL, player_id uuid NOT NULL,
  action_type text NOT NULL CHECK (action_type IN ('hold','buy','sell')),
  category text CHECK (category IN ('car','gold','currency','equipment','materials')),
  amount_tomans bigint NOT NULL DEFAULT 0 CHECK (amount_tomans >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delegated','executed','rejected')),
  reason text,
  submitted_at timestamptz,
  processed_at timestamptz,
  PRIMARY KEY (room_id, period_key, player_id),
  FOREIGN KEY (room_id, period_key) REFERENCES room_turns(room_id, period_key),
  FOREIGN KEY (room_id, player_id) REFERENCES room_members(room_id, player_id),
  CHECK ((action_type = 'hold' AND category IS NULL AND amount_tomans = 0)
      OR (action_type IN ('buy','sell') AND category IS NOT NULL AND amount_tomans > 0))
);

-- Player owned city sites and their durable construction history.
CREATE TABLE IF NOT EXISTS city_buildings (
  room_id uuid NOT NULL,
  player_id uuid NOT NULL,
  building_id text NOT NULL CHECK (building_id IN ('workshop','market','homes','civic','park')),
  level integer NOT NULL CHECK (level BETWEEN 1 AND 5),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, player_id, building_id),
  FOREIGN KEY (room_id, player_id) REFERENCES room_members(room_id, player_id)
);
CREATE TABLE IF NOT EXISTS city_building_transactions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id uuid NOT NULL,
  period_key text NOT NULL,
  player_id uuid NOT NULL,
  building_id text NOT NULL CHECK (building_id IN ('workshop','market','homes','civic','park')),
  operation text NOT NULL CHECK (operation IN ('build','upgrade')),
  previous_level integer NOT NULL CHECK (previous_level BETWEEN 0 AND 4),
  new_level integer NOT NULL CHECK (new_level BETWEEN 1 AND 5),
  cost_tomans bigint NOT NULL CHECK (cost_tomans > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (room_id, period_key) REFERENCES room_turns(room_id, period_key),
  FOREIGN KEY (room_id, player_id) REFERENCES room_members(room_id, player_id),
  CHECK (new_level = previous_level + 1),
  CHECK ((operation = 'build' AND previous_level = 0) OR (operation = 'upgrade' AND previous_level > 0))
);
CREATE INDEX IF NOT EXISTS city_building_history_idx ON city_building_transactions(room_id, player_id, period_key);

-- Player-operated businesses, multi-branch ownership, partnership contracts and period accounts.
CREATE TABLE IF NOT EXISTS business_branches (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms(id),
  model_id text NOT NULL CHECK (model_id IN ('grocery','cafe','workshop','tailoring','transport','rental','clinic','academy','farm','digital')),
  branch_number integer NOT NULL CHECK (branch_number BETWEEN 1 AND 3),
  level integer NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 5),
  manager_enabled boolean NOT NULL DEFAULT true,
  unpaid_expenses_tomans bigint NOT NULL DEFAULT 0 CHECK (unpaid_expenses_tomans >= 0),
  retained_earnings_tomans bigint NOT NULL DEFAULT 0 CHECK (retained_earnings_tomans >= 0),
  created_period text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,room_id),
  UNIQUE (room_id,model_id,branch_number),
  FOREIGN KEY (room_id,created_period) REFERENCES room_turns(room_id,period_key)
);
CREATE TABLE IF NOT EXISTS business_owners (
  room_id uuid NOT NULL,
  business_id uuid NOT NULL,
  player_id uuid NOT NULL,
  share_bps integer NOT NULL CHECK (share_bps BETWEEN 1 AND 10000),
  capital_contributed_tomans bigint NOT NULL DEFAULT 0 CHECK (capital_contributed_tomans >= 0),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id,player_id),
  FOREIGN KEY (business_id,room_id) REFERENCES business_branches(id,room_id),
  FOREIGN KEY (room_id,player_id) REFERENCES room_members(room_id,player_id)
);
CREATE TABLE IF NOT EXISTS business_partnership_offers (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL,
  business_id uuid NOT NULL,
  proposer_id uuid NOT NULL,
  invitee_id uuid NOT NULL,
  share_bps integer NOT NULL CHECK (share_bps BETWEEN 1 AND 9000),
  contribution_tomans bigint NOT NULL CHECK (contribution_tomans >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','expired')),
  period_key text NOT NULL,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id,room_id) REFERENCES business_branches(id,room_id),
  FOREIGN KEY (room_id,proposer_id) REFERENCES room_members(room_id,player_id),
  FOREIGN KEY (room_id,invitee_id) REFERENCES room_members(room_id,player_id),
  FOREIGN KEY (room_id,period_key) REFERENCES room_turns(room_id,period_key),
  CHECK (proposer_id <> invitee_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS business_one_pending_offer_idx ON business_partnership_offers(business_id) WHERE status='pending';
CREATE TABLE IF NOT EXISTS business_period_results (
  room_id uuid NOT NULL,
  period_key text NOT NULL,
  business_id uuid NOT NULL,
  revenue_tomans bigint NOT NULL CHECK (revenue_tomans >= 0),
  materials_cost_tomans bigint NOT NULL CHECK (materials_cost_tomans >= 0),
  payroll_cost_tomans bigint NOT NULL CHECK (payroll_cost_tomans >= 0),
  overhead_cost_tomans bigint NOT NULL CHECK (overhead_cost_tomans >= 0),
  manager_cost_tomans bigint NOT NULL CHECK (manager_cost_tomans >= 0),
  net_profit_tomans bigint NOT NULL,
  distributed_tomans bigint NOT NULL DEFAULT 0 CHECK (distributed_tomans >= 0),
  retained_tomans bigint NOT NULL DEFAULT 0 CHECK (retained_tomans >= 0),
  unpaid_expenses_tomans bigint NOT NULL DEFAULT 0 CHECK (unpaid_expenses_tomans >= 0),
  PRIMARY KEY (room_id,period_key,business_id),
  FOREIGN KEY (room_id,period_key) REFERENCES economic_periods(room_id,period_key),
  FOREIGN KEY (business_id,room_id) REFERENCES business_branches(id,room_id)
);
CREATE TABLE IF NOT EXISTS business_ledger (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id uuid NOT NULL,
  business_id uuid NOT NULL,
  period_key text NOT NULL,
  player_id uuid,
  entry_kind text NOT NULL CHECK (entry_kind IN ('startup','partner_capital','revenue','materials','payroll','overhead','manager','profit_distribution','retained')),
  amount_tomans bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id,room_id) REFERENCES business_branches(id,room_id),
  FOREIGN KEY (room_id,period_key) REFERENCES room_turns(room_id,period_key),
  FOREIGN KEY (room_id,player_id) REFERENCES room_members(room_id,player_id)
);
CREATE INDEX IF NOT EXISTS business_owner_lookup_idx ON business_owners(room_id,player_id);
CREATE INDEX IF NOT EXISTS business_results_player_idx ON business_period_results(room_id,period_key);

CREATE TABLE IF NOT EXISTS rent_arrears (
  room_id uuid NOT NULL, account_id uuid NOT NULL, period_key text NOT NULL,
  amount_tomans bigint NOT NULL CHECK (amount_tomans > 0),
  paid_tomans bigint NOT NULL DEFAULT 0 CHECK (paid_tomans >= 0 AND paid_tomans <= amount_tomans),
  PRIMARY KEY (room_id, account_id, period_key),
  FOREIGN KEY (account_id, room_id) REFERENCES economy_accounts(id, room_id),
  FOREIGN KEY (room_id, period_key) REFERENCES economic_periods(room_id, period_key)
);
CREATE TABLE IF NOT EXISTS loans (
  id uuid PRIMARY KEY, room_id uuid NOT NULL, borrower_id uuid NOT NULL, lender_id uuid,
  principal_tomans bigint NOT NULL CHECK (principal_tomans >= 0),
  rate_kind text NOT NULL CHECK (rate_kind IN ('fixed','variable')),
  fixed_annual_rate_bps integer, variable_margin_bps integer,
  months_remaining integer NOT NULL CHECK (months_remaining >= 0),
  arrears_interest_tomans bigint NOT NULL DEFAULT 0 CHECK (arrears_interest_tomans >= 0),
  arrears_principal_tomans bigint NOT NULL DEFAULT 0 CHECK (arrears_principal_tomans >= 0),
  arrears_fee_tomans bigint NOT NULL DEFAULT 0 CHECK (arrears_fee_tomans >= 0),
  monthly_penalty_bps integer NOT NULL DEFAULT 0 CHECK (monthly_penalty_bps >= 0),
  UNIQUE (id, room_id),
  FOREIGN KEY (borrower_id, room_id) REFERENCES economy_accounts(id, room_id),
  CHECK (fixed_annual_rate_bps IS NULL OR fixed_annual_rate_bps BETWEEN 0 AND 1000000),
  CHECK (variable_margin_bps IS NULL OR variable_margin_bps BETWEEN -1800 AND 1000000),
  CHECK ((rate_kind = 'fixed' AND fixed_annual_rate_bps IS NOT NULL AND variable_margin_bps IS NULL)
      OR (rate_kind = 'variable' AND fixed_annual_rate_bps IS NULL AND variable_margin_bps IS NOT NULL)),
  CHECK (principal_tomans >= arrears_principal_tomans)
);
ALTER TABLE loans ADD COLUMN IF NOT EXISTS lender_id uuid;
DO $$ BEGIN ALTER TABLE loans ADD CONSTRAINT loans_room_lender_fk FOREIGN KEY (room_id,lender_id) REFERENCES room_members(room_id,player_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS loan_originations (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL,
  player_id uuid NOT NULL,
  loan_id uuid NOT NULL,
  period_key text NOT NULL,
  amount_tomans bigint NOT NULL CHECK (amount_tomans > 0),
  annual_rate_bps integer NOT NULL CHECK (annual_rate_bps BETWEEN 0 AND 1000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, player_id, period_key),
  FOREIGN KEY (room_id, player_id) REFERENCES room_members(room_id, player_id),
  FOREIGN KEY (loan_id, room_id) REFERENCES loans(id, room_id),
  FOREIGN KEY (room_id, period_key) REFERENCES room_turns(room_id, period_key)
);
CREATE TABLE IF NOT EXISTS debt_restructure_events (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL,
  player_id uuid NOT NULL,
  period_key text NOT NULL,
  consolidated_loan_id uuid NOT NULL,
  original_debt_tomans bigint NOT NULL CHECK (original_debt_tomans > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, player_id, period_key),
  FOREIGN KEY (room_id, player_id) REFERENCES room_members(room_id, player_id),
  FOREIGN KEY (room_id, period_key) REFERENCES room_turns(room_id, period_key),
  FOREIGN KEY (consolidated_loan_id, room_id) REFERENCES loans(id, room_id)
);
CREATE TABLE IF NOT EXISTS checks (
  id uuid PRIMARY KEY, room_id uuid NOT NULL,
  issuer_id uuid NOT NULL, payee_id uuid NOT NULL,
  due_period text NOT NULL CHECK (due_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  amount_tomans bigint NOT NULL CHECK (amount_tomans > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','bounced')),
  settled_period text, UNIQUE (id, room_id),
  FOREIGN KEY (issuer_id, room_id) REFERENCES economy_accounts(id, room_id),
  FOREIGN KEY (payee_id, room_id) REFERENCES economy_accounts(id, room_id),
  FOREIGN KEY (room_id, settled_period) REFERENCES economic_periods(room_id, period_key),
  CHECK (issuer_id <> payee_id)
);
CREATE TABLE IF NOT EXISTS guarantees (
  id uuid PRIMARY KEY, room_id uuid NOT NULL, guarantor_id uuid NOT NULL,
  loan_id uuid, check_id uuid,
  cap_tomans bigint NOT NULL CHECK (cap_tomans > 0),
  claimed_tomans bigint NOT NULL DEFAULT 0 CHECK (claimed_tomans >= 0 AND claimed_tomans <= cap_tomans),
  UNIQUE (id, room_id),
  FOREIGN KEY (guarantor_id, room_id) REFERENCES economy_accounts(id, room_id),
  FOREIGN KEY (loan_id, room_id) REFERENCES loans(id, room_id),
  FOREIGN KEY (check_id, room_id) REFERENCES checks(id, room_id),
  CHECK ((loan_id IS NOT NULL)::integer + (check_id IS NOT NULL)::integer = 1)
);
CREATE TABLE IF NOT EXISTS guarantee_claims (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id uuid NOT NULL, guarantee_id uuid NOT NULL, period_key text NOT NULL,
  amount_tomans bigint NOT NULL CHECK (amount_tomans > 0),
  paid_tomans bigint NOT NULL DEFAULT 0 CHECK (paid_tomans >= 0 AND paid_tomans <= amount_tomans),
  reason text NOT NULL CHECK (reason IN ('loan_arrears','bounced_check')),
  restructured_at timestamptz,
  UNIQUE (room_id, guarantee_id, period_key, reason),
  FOREIGN KEY (guarantee_id, room_id) REFERENCES guarantees(id, room_id),
  FOREIGN KEY (room_id, period_key) REFERENCES economic_periods(room_id, period_key)
);
ALTER TABLE guarantee_claims ADD COLUMN IF NOT EXISTS restructured_at timestamptz;
ALTER TABLE guarantee_claims ADD COLUMN IF NOT EXISTS paid_tomans bigint NOT NULL DEFAULT 0 CHECK (paid_tomans >= 0 AND paid_tomans <= amount_tomans);
CREATE TABLE IF NOT EXISTS check_guarantee_requests (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL,
  period_key text NOT NULL,
  issuer_id uuid NOT NULL,
  payee_id uuid NOT NULL,
  guarantor_id uuid NOT NULL,
  due_period text NOT NULL CHECK (due_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  amount_tomans bigint NOT NULL CHECK (amount_tomans > 0),
  guarantee_cap_tomans bigint NOT NULL CHECK (guarantee_cap_tomans >= amount_tomans),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','expired')),
  check_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (room_id, period_key) REFERENCES room_turns(room_id, period_key),
  FOREIGN KEY (room_id, issuer_id) REFERENCES room_members(room_id, player_id),
  FOREIGN KEY (room_id, payee_id) REFERENCES room_members(room_id, player_id),
  FOREIGN KEY (room_id, guarantor_id) REFERENCES room_members(room_id, player_id),
  FOREIGN KEY (check_id, room_id) REFERENCES checks(id, room_id),
  CHECK (issuer_id <> payee_id AND issuer_id <> guarantor_id AND payee_id <> guarantor_id)
);
CREATE INDEX IF NOT EXISTS check_guarantee_pending_idx ON check_guarantee_requests(room_id, guarantor_id, period_key) WHERE status='pending';
CREATE TABLE IF NOT EXISTS economy_ledger (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id uuid NOT NULL, period_key text NOT NULL, account_id uuid NOT NULL,
  source_kind text NOT NULL, source_id text NOT NULL,
  amount_tomans bigint NOT NULL,
  balance_before_tomans bigint NOT NULL DEFAULT 0 CHECK (balance_before_tomans >= 0),
  balance_after_tomans bigint NOT NULL CHECK (balance_after_tomans >= 0),
  CHECK (balance_after_tomans = balance_before_tomans + amount_tomans),
  UNIQUE (room_id, period_key, account_id, source_kind, source_id),
  FOREIGN KEY (account_id, room_id) REFERENCES economy_accounts(id, room_id),
  FOREIGN KEY (room_id, period_key) REFERENCES room_turns(room_id, period_key)
);
ALTER TABLE economy_ledger ADD COLUMN IF NOT EXISTS balance_before_tomans bigint NOT NULL DEFAULT 0 CHECK (balance_before_tomans >= 0);
UPDATE economy_ledger SET balance_before_tomans=balance_after_tomans-amount_tomans WHERE balance_before_tomans=0;
ALTER TABLE economy_ledger DROP CONSTRAINT IF EXISTS economy_ledger_balance_conservation_check;
ALTER TABLE economy_ledger ADD CONSTRAINT economy_ledger_balance_conservation_check CHECK (balance_after_tomans=balance_before_tomans+amount_tomans);
ALTER TABLE economy_ledger DROP CONSTRAINT IF EXISTS economy_ledger_room_id_period_key_fkey;
ALTER TABLE economy_ledger ADD CONSTRAINT economy_ledger_room_id_period_key_fkey FOREIGN KEY (room_id, period_key) REFERENCES room_turns(room_id, period_key);
CREATE INDEX IF NOT EXISTS checks_due_idx ON checks(room_id, due_period) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS loans_borrower_idx ON loans(room_id, borrower_id);
CREATE INDEX IF NOT EXISTS turns_due_idx ON room_turns(deadline_at) WHERE status = 'open';

-- Player-to-player contracts. An accepted cash loan becomes a normal amortizing loan;
-- an accepted asset offer settles both cash and holdings in the same transaction.
CREATE TABLE IF NOT EXISTS player_contracts (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL,
  period_key text NOT NULL,
  proposer_id uuid NOT NULL,
  counterparty_id uuid NOT NULL,
  contract_kind text NOT NULL CHECK (contract_kind IN ('loan','asset_trade')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','expired')),
  amount_tomans bigint NOT NULL CHECK (amount_tomans > 0),
  interest_bps integer,
  months integer,
  asset_category text CHECK (asset_category IS NULL OR asset_category IN ('car','gold','currency','equipment','materials')),
  asset_value_tomans bigint CHECK (asset_value_tomans IS NULL OR asset_value_tomans > 0),
  due_period text,
  loan_id uuid,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id,id),
  FOREIGN KEY (room_id,period_key) REFERENCES room_turns(room_id,period_key),
  FOREIGN KEY (room_id,proposer_id) REFERENCES room_members(room_id,player_id),
  FOREIGN KEY (room_id,counterparty_id) REFERENCES room_members(room_id,player_id),
  FOREIGN KEY (loan_id,room_id) REFERENCES loans(id,room_id),
  CHECK (proposer_id <> counterparty_id),
  CHECK ((contract_kind='loan' AND interest_bps BETWEEN 0 AND 1000000 AND months BETWEEN 1 AND 120 AND asset_category IS NULL AND asset_value_tomans IS NULL)
      OR (contract_kind='asset_trade' AND interest_bps IS NULL AND months IS NULL AND asset_category IS NOT NULL AND asset_value_tomans IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS player_contracts_inbox_idx ON player_contracts(room_id,counterparty_id,created_at) WHERE status='pending';
CREATE TABLE IF NOT EXISTS player_contract_ledger (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id uuid NOT NULL,
  period_key text NOT NULL,
  contract_id uuid NOT NULL,
  player_id uuid NOT NULL,
  entry_kind text NOT NULL CHECK (entry_kind IN ('loan_funded','loan_received','loan_repayment','loan_repayment_received','cash_paid','cash_received','asset_sent','asset_received')),
  cash_change_tomans bigint NOT NULL,
  cash_balance_after_tomans bigint NOT NULL CHECK (cash_balance_after_tomans >= 0),
  asset_category text,
  asset_change_tomans bigint NOT NULL DEFAULT 0,
  asset_balance_after_tomans bigint,
  FOREIGN KEY (room_id,period_key) REFERENCES room_turns(room_id,period_key),
  FOREIGN KEY (room_id,contract_id) REFERENCES player_contracts(room_id,id),
  FOREIGN KEY (room_id,player_id) REFERENCES room_members(room_id,player_id),
  CHECK ((asset_category IS NULL AND asset_change_tomans=0 AND asset_balance_after_tomans IS NULL)
      OR (asset_category IN ('car','gold','currency','equipment','materials') AND asset_balance_after_tomans >= 0))
);

-- HUD support: room readiness, persisted delegate preferences, and lightweight room chat.
CREATE TABLE IF NOT EXISTS room_turn_ready (
  room_id uuid NOT NULL,
  period_key text NOT NULL,
  player_id uuid NOT NULL,
  ready_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, period_key, player_id),
  FOREIGN KEY (room_id, period_key) REFERENCES room_turns(room_id, period_key),
  FOREIGN KEY (room_id, player_id) REFERENCES room_members(room_id, player_id)
);
CREATE TABLE IF NOT EXISTS autopilot_policies (
  room_id uuid NOT NULL,
  player_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  strategy text NOT NULL DEFAULT 'balanced' CHECK (strategy IN ('reserve','balanced','growth')),
  reserve_months integer NOT NULL DEFAULT 1 CHECK (reserve_months BETWEEN 0 AND 6),
  invest_surplus_bps integer NOT NULL DEFAULT 2500 CHECK (invest_surplus_bps BETWEEN 0 AND 5000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, player_id),
  FOREIGN KEY (room_id, player_id) REFERENCES room_members(room_id, player_id)
);
CREATE TABLE IF NOT EXISTS room_chat_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id uuid NOT NULL,
  player_id uuid NOT NULL,
  message text NOT NULL CHECK (length(message) BETWEEN 1 AND 280),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (room_id, player_id) REFERENCES room_members(room_id, player_id)
);
CREATE INDEX IF NOT EXISTS room_chat_recent_idx ON room_chat_messages(room_id, id DESC);

-- Progression, event choices, funds, insurance, auctions, and quality-of-life challenges.
CREATE TABLE IF NOT EXISTS player_skills (
  room_id uuid NOT NULL,
  player_id uuid NOT NULL,
  management integer NOT NULL DEFAULT 0 CHECK (management BETWEEN 0 AND 10),
  negotiation integer NOT NULL DEFAULT 0 CHECK (negotiation BETWEEN 0 AND 10),
  marketing integer NOT NULL DEFAULT 0 CHECK (marketing BETWEEN 0 AND 10),
  skill_points integer NOT NULL DEFAULT 1 CHECK (skill_points BETWEEN 0 AND 99),
  experience_points integer NOT NULL DEFAULT 0 CHECK (experience_points >= 0),
  PRIMARY KEY (room_id,player_id),
  FOREIGN KEY (room_id,player_id) REFERENCES room_members(room_id,player_id)
);
CREATE TABLE IF NOT EXISTS room_event_cards (
  room_id uuid NOT NULL,
  period_key text NOT NULL,
  card_id text NOT NULL CHECK (card_id IN ('supply_shock','business_disruption','city_contract','mentor_visit')),
  kind text NOT NULL CHECK (kind IN ('crisis','opportunity','skill')),
  title text NOT NULL,
  description text NOT NULL,
  effect jsonb NOT NULL,
  PRIMARY KEY (room_id,period_key),
  FOREIGN KEY (room_id,period_key) REFERENCES room_turns(room_id,period_key)
);
CREATE TABLE IF NOT EXISTS player_event_choices (
  room_id uuid NOT NULL,
  period_key text NOT NULL,
  player_id uuid NOT NULL,
  choice text NOT NULL CHECK (choice IN ('accept','decline','management','negotiation','marketing')),
  PRIMARY KEY (room_id,period_key,player_id),
  FOREIGN KEY (room_id,period_key) REFERENCES room_event_cards(room_id,period_key),
  FOREIGN KEY (room_id,player_id) REFERENCES room_members(room_id,player_id)
);
CREATE TABLE IF NOT EXISTS fund_positions (
  room_id uuid NOT NULL,
  player_id uuid NOT NULL,
  fund_id text NOT NULL CHECK (fund_id IN ('balanced','growth','hedge')),
  market_value_tomans bigint NOT NULL DEFAULT 0 CHECK (market_value_tomans >= 0),
  PRIMARY KEY (room_id,player_id,fund_id),
  FOREIGN KEY (room_id,player_id) REFERENCES room_members(room_id,player_id)
);
CREATE TABLE IF NOT EXISTS insurance_policies (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL,
  player_id uuid NOT NULL,
  plan_id text NOT NULL CHECK (plan_id IN ('crisis','business')),
  premium_tomans bigint NOT NULL CHECK (premium_tomans > 0),
  coverage_tomans bigint NOT NULL CHECK (coverage_tomans > 0),
  active boolean NOT NULL DEFAULT true,
  purchased_period text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id,player_id,plan_id),
  FOREIGN KEY (room_id,player_id) REFERENCES room_members(room_id,player_id),
  FOREIGN KEY (room_id,purchased_period) REFERENCES room_turns(room_id,period_key)
);
CREATE TABLE IF NOT EXISTS insurance_claims (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id uuid NOT NULL,
  period_key text NOT NULL,
  policy_id uuid NOT NULL,
  amount_tomans bigint NOT NULL CHECK (amount_tomans > 0),
  reason text NOT NULL CHECK (reason IN ('supply_shock','business_loss')),
  UNIQUE (policy_id,period_key,reason),
  FOREIGN KEY (room_id,period_key) REFERENCES room_turns(room_id,period_key),
  FOREIGN KEY (policy_id) REFERENCES insurance_policies(id)
);
CREATE TABLE IF NOT EXISTS player_auctions (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  period_key text NOT NULL,
  asset_category text NOT NULL CHECK (asset_category IN ('car','gold','currency','equipment','materials')),
  asset_value_tomans bigint NOT NULL CHECK (asset_value_tomans > 0),
  reserve_price_tomans bigint NOT NULL CHECK (reserve_price_tomans > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','sold','no_sale')),
  winner_id uuid,
  winning_bid_tomans bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (room_id,seller_id) REFERENCES room_members(room_id,player_id),
  FOREIGN KEY (room_id,period_key) REFERENCES room_turns(room_id,period_key),
  FOREIGN KEY (room_id,winner_id) REFERENCES room_members(room_id,player_id)
);
CREATE TABLE IF NOT EXISTS player_auction_bids (
  room_id uuid NOT NULL,
  auction_id uuid NOT NULL,
  bidder_id uuid NOT NULL,
  bid_tomans bigint NOT NULL CHECK (bid_tomans > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (auction_id,bidder_id),
  FOREIGN KEY (auction_id) REFERENCES player_auctions(id),
  FOREIGN KEY (room_id,bidder_id) REFERENCES room_members(room_id,player_id)
);
CREATE INDEX IF NOT EXISTS player_auctions_room_open_idx ON player_auctions(room_id,period_key) WHERE status='open';
CREATE TABLE IF NOT EXISTS player_challenges (
  room_id uuid NOT NULL,
  player_id uuid NOT NULL,
  challenge_id text NOT NULL CHECK (challenge_id IN ('financial_freedom','debt_exit')),
  completed boolean NOT NULL DEFAULT false,
  completed_period text,
  PRIMARY KEY (room_id,player_id,challenge_id),
  FOREIGN KEY (room_id,player_id) REFERENCES room_members(room_id,player_id),
  FOREIGN KEY (room_id,completed_period) REFERENCES room_turns(room_id,period_key)
);
CREATE TABLE IF NOT EXISTS wellbeing_scores (
  room_id uuid NOT NULL,
  player_id uuid NOT NULL,
  period_key text NOT NULL,
  free_time integer NOT NULL CHECK (free_time BETWEEN 0 AND 100),
  health integer NOT NULL CHECK (health BETWEEN 0 AND 100),
  security integer NOT NULL CHECK (security BETWEEN 0 AND 100),
  PRIMARY KEY (room_id,player_id,period_key),
  FOREIGN KEY (room_id,player_id) REFERENCES room_members(room_id,player_id),
  FOREIGN KEY (room_id,period_key) REFERENCES room_turns(room_id,period_key)
);
