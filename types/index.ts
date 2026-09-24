// ─── Ticket ───────────────────────────────────────────────────────────────────

export interface Ticket {
  id: string;
  farmer_code: string;
  name: string;
  fatherName: string;
  caneOwner: string;
  date: string;
  quantity: number;
  comment?: string;
  seasonId: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Season {
  id: string;
  label: string;
  startYear: number;
  endYear: number;
  isCurrent: boolean;
}

export type TicketInput = Omit<Ticket, 'id' | 'createdAt' | 'updatedAt' | 'seasonId'>;

// ─── Form ─────────────────────────────────────────────────────────────────────

export interface FormData {
  farmer_code: string;
  name: string;
  fatherName: string;
  caneOwner: string;
  date: string;
  quantity: string;
  comment: string;
}

export type ConfirmedValues = Partial<FormData>;

// ─── Batch Entry ──────────────────────────────────────────────────────────────

/** A single slip inside a batch — only slip-level fields */
export interface BatchSlipItem {
  id: string;           // local-only temp ID for list key
  date: string;
  caneOwner: string;
  quantity: string;
  comment: string;
}

// ─── Recent Farmer ────────────────────────────────────────────────────────────

export interface RecentFarmer {
  farmer_code: string;
  name: string;
  fatherName: string;
  lastUsedAt: string;   // ISO date string — used for sorting
}

// ─── Mill Payment Settings ────────────────────────────────────────────────────

export interface MillPaymentSettings {
  /** DD/MM/YYYY — mill has paid for all slips on or before this date */
  paidUntilDate: string;
}

// ─── Backup / Restore ────────────────────────────────────────────────────────

export interface BackupPayload {
  version: number;
  exportedAt: string;                              // ISO
  appName: 'SmartKissan';
  seasons: {
    seasonId: string;
    tickets: Ticket[];
  }[];
  millPaymentSettings: Record<string, MillPaymentSettings | null>;
}
