export interface ReceiptItem {
  id?: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  notes?: string;
  isDeal?: boolean;
  dealComponents?: string[];
}

export interface ReceiptData {
  receiptNumber?: string;
  orderNumber?: number | string;
  orderId?: string;
  date?: string | Date;
  restaurant?: {
    name: string;
    address: string;
    phone: string;
    email: string;
    logoUrl?: string | null;
  };
  server?: string;
  orderType?: string;
  table?: string;
  customerName?: string;
  customerPhone?: string;
  notes?: string;
  items: ReceiptItem[];
  subtotal: number;
  serviceCharge?: number;
  serviceChargeRate?: number;
  deliveryCharge?: number;
  tax?: number;
  taxRate?: number;
  tipAmount?: number;
  total: number;
  totalPaid?: number;
  change?: number;
  paymentMethod?: string;
  amountDue?: number;
  balanceDue?: number;
  settledToCredit?: boolean;
}
