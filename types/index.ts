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

export type TicketInput = Omit<Ticket, 'id' | 'createdAt' | 'updatedAt'| 'seasonId'>;

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
