export type Channel = '微信' | '支付宝';
export type PaymentChoice = { channel: Channel; method: string };

export type Expense = {
  id: string;
  amount: number;
  merchant: string;
  category: string;
  channel: Channel;
  method: string;
  occurredAt: string;
  note?: string;
  source?: 'manual' | 'import';
  externalId?: string;
  batchId?: string;
  importedAt?: string;
  sourceFile?: string;
  demo?: boolean;
};

type OperationBase = {
  operationId: string;
  deviceId: string;
  queuedAt: string;
};

export type SyncOperation = OperationBase & (
  | { kind: 'upsert'; expense: Expense }
  | { kind: 'delete'; expenseId: string }
  | { kind: 'settings'; settings: { budget: number; lastPayment: PaymentChoice } }
);

export type SyncChange =
  | { kind: 'upsert'; expense: Expense; revision: number }
  | { kind: 'delete'; expenseId: string; revision: number };

export type SyncResponse = {
  revision: number;
  changes: SyncChange[];
  settings: { budget: number; lastPayment: PaymentChoice; revision: number };
  acceptedOperationIds: string[];
  serverTime: string;
  state?: { version: 1; budget: number; expenses: Expense[]; lastPayment: PaymentChoice };
  updatedAt?: string;
};
