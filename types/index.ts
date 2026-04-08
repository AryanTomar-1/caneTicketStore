// ─── Ticket ───────────────────────────────────────────────────────────────────

export interface Ticket {
  id: string;
  farmer_code: string;
  name: string;
  fatherName: string;
  date: string;
  quantity: number;
  comment?: string;
  createdAt: string;
  updatedAt?: string;
}

export type TicketInput = Omit<Ticket, 'id' | 'createdAt' | 'updatedAt'>;

// ─── Form ─────────────────────────────────────────────────────────────────────

export interface FormData {
  farmer_code: string;
  name: string;
  fatherName: string;
  date: string;
  quantity: string;
  comment: string;
}

export type ConfirmedValues = Partial<FormData>;
