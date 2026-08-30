export const createUserStateTable = `
  CREATE TABLE IF NOT EXISTS user_state (
    user_id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  )
`;

export const createSyncMetaTable = `
  CREATE TABLE IF NOT EXISTS sync_meta (
    user_id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL DEFAULT 0,
    migration_completed INTEGER NOT NULL DEFAULT 0
  )
`;

export const createExpenseRecordsTable = `
  CREATE TABLE IF NOT EXISTS expense_records (
    user_id TEXT NOT NULL,
    expense_id TEXT NOT NULL,
    payload TEXT,
    updated_revision INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, expense_id)
  )
`;

export const createAccountSettingsTable = `
  CREATE TABLE IF NOT EXISTS account_settings (
    user_id TEXT PRIMARY KEY,
    budget REAL NOT NULL DEFAULT 5000,
    last_channel TEXT NOT NULL DEFAULT '微信',
    last_method TEXT NOT NULL DEFAULT '零钱',
    updated_revision INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )
`;

export const createProcessedOperationsTable = `
  CREATE TABLE IF NOT EXISTS processed_operations (
    user_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    processed_at TEXT NOT NULL,
    PRIMARY KEY (user_id, operation_id)
  )
`;

export const createExpenseRevisionIndex = `
  CREATE INDEX IF NOT EXISTS idx_expense_records_user_revision
  ON expense_records (user_id, updated_revision)
`;
