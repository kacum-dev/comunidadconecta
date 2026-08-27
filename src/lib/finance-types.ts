export interface FinanceAllocation {
  id: string;
  financialRecordId: string;
  financialTitle: string;
  amount: number;
  createdAt: string;
}

export interface FinanceRecordSummary {
  id: string;
  title: string;
  code: string;
  kind: string;
  status: string;
  amount: number;
  allocated: number;
  remaining: number;
  eventDate: string | null;
  dueDate: string | null;
  eventTimePrecision: "day" | "minute" | "second" | null;
  dueTimePrecision: "day" | "minute" | "second" | null;
  dueInclusive: boolean;
  paidAt: string | null;
  paidTimePrecision: "minute" | "second" | null;
  contact: string;
}

export interface FinanceSuggestion {
  financialRecordId: string;
  title: string;
  code: string;
  score: number;
  recommendedAmount: number;
  reasons: string[];
}

export interface BankTransactionSummary {
  id: string;
  title: string;
  code: string;
  status: string;
  kind: string;
  amount: number;
  allocated: number;
  remaining: number;
  eventDate: string;
  eventTimePrecision: "day" | "minute" | "second" | null;
  contact: string;
  description: string;
  suggestions: FinanceSuggestion[];
  allocations: FinanceAllocation[];
}

export interface FinanceMetrics {
  receivable: number;
  overdue: number;
  paid: number;
  invoicesPending: number;
  bankUnmatched: number;
  bankUnmatchedCount: number;
}

export interface FinanceDashboardDTO {
  metrics: FinanceMetrics;
  records: FinanceRecordSummary[];
  transactions: BankTransactionSummary[];
  accounting: {
    enabled: boolean;
    accessible: boolean;
    canManage: boolean;
    automaticEntries: number;
  };
}
