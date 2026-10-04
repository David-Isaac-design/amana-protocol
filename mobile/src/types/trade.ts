export type TradeStatus =
  | 'PENDING'
  | 'FUNDED'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'DISPUTED'
  | 'COMPLETED'
  | 'REFUNDED';

export interface Trade {
  id: number;
  tradeId: string;
  buyerAddress: string;
  sellerAddress: string;
  amountUsdc: string;
  status: TradeStatus;
  createdAt?: string;
  updatedAt?: string;
  buyerLossBps?: number;
  sellerLossBps?: number;
  commodity?: string;
  quantity?: string;
  unit?: string;
}

export interface TradeListResult {
  trades: Trade[];
  total: number;
  page: number;
  limit: number;
}

export interface TradeNote {
  id: string;
  tradeId: string;
  authorAddress: string;
  content: string;
  createdAt: string;
}

export interface TradeNotesResult {
  notes: TradeNote[];
}
