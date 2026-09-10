import React, { useState } from 'react';
import { formatPKR } from '../utils/format';

export interface ReceiptItem {
  id?: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  notes?: string;
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
  };
  server?: string;
  orderType?: string;
  table?: string;
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
}

interface ReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  receiptData: ReceiptData | null;
  defaultTab?: 'BOTH' | 'CUSTOMER' | 'KITCHEN';
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  isOpen,
  onClose,
  receiptData,
  defaultTab = 'BOTH',
}) => {
  const [activeTab, setActiveTab] = useState<'BOTH' | 'CUSTOMER' | 'KITCHEN'>(defaultTab);

  if (!isOpen || !receiptData) return null;

  const handlePrint = (tabToPrint?: 'BOTH' | 'CUSTOMER' | 'KITCHEN') => {
    if (tabToPrint) {
      setActiveTab(tabToPrint);
      setTimeout(() => {
        window.print();
      }, 50);
    } else {
      window.print();
    }
  };

  const formattedDate = receiptData.date
    ? new Date(receiptData.date).toLocaleString('en-PK', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : new Date().toLocaleString('en-PK');

  const restaurantName = receiptData.restaurant?.name || 'Gourmet Bistro & Grill';
  const restaurantAddress = receiptData.restaurant?.address || 'Main Boulevard, Gulberg III, Lahore';
  const restaurantPhone = receiptData.restaurant?.phone || '+92 (42) 3578-9000';
  const orderNumStr = String(receiptData.orderNumber || receiptData.orderId?.slice(0, 6) || '101');
  const typeDisplay = receiptData.orderType || 'Dine In';

  return (
    <div className="modal-overlay no-print-bg" onClick={onClose}>
      <div
        className="modal-content"
        style={{ maxWidth: '580px', background: '#0f172a' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header no-print">
          <div>
            <h3 className="modal-title">🖨️ Order Slips & Printing</h3>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Dual Receipt System • Order #{orderNumStr} ({typeDisplay})
            </span>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Tab Selection (No-Print) */}
        <div
          className="no-print"
          style={{
            display: 'flex',
            gap: '8px',
            padding: '12px 20px',
            background: 'rgba(255, 255, 255, 0.03)',
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          <button
            className={`btn btn-sm ${activeTab === 'BOTH' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ flex: 1 }}
            onClick={() => setActiveTab('BOTH')}
          >
            📑 Both Slips (Dual)
          </button>
          <button
            className={`btn btn-sm ${activeTab === 'CUSTOMER' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ flex: 1 }}
            onClick={() => setActiveTab('CUSTOMER')}
          >
            🧾 Customer Slip
          </button>
          <button
            className={`btn btn-sm ${activeTab === 'KITCHEN' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ flex: 1 }}
            onClick={() => setActiveTab('KITCHEN')}
          >
            🍳 Kitchen Ticket (KOT)
          </button>
        </div>

        <div className="modal-body" style={{ padding: '20px', overflowY: 'auto', maxHeight: '65vh' }}>
          <div className="print-slips-container">
            {/* 1. CUSTOMER RECEIPT (Rendered if BOTH or CUSTOMER active) */}
            {(activeTab === 'BOTH' || activeTab === 'CUSTOMER') && (
              <div
                className={`receipt-paper customer-slip ${activeTab === 'BOTH' ? 'slip-page-break' : ''}`}
                id="customer-receipt"
              >
                <div className="receipt-badge">CUSTOMER RECEIPT</div>
                <div className="receipt-header">
                  <div className="receipt-restaurant-name">{restaurantName}</div>
                  <div style={{ fontSize: '11px', color: '#444' }}>{restaurantAddress}</div>
                  <div style={{ fontSize: '11px', color: '#444' }}>Tel: {restaurantPhone}</div>
                </div>

                <hr className="receipt-divider" />

                <div className="receipt-row" style={{ fontSize: '11px', fontWeight: 600 }}>
                  <span>Order #: {orderNumStr}</span>
                  <span>{formattedDate}</span>
                </div>
                <div className="receipt-row" style={{ fontSize: '11px', fontWeight: 700 }}>
                  <span>TYPE: {typeDisplay.toUpperCase()}</span>
                  <span>Cashier: {receiptData.server || 'Cashier'}</span>
                </div>
                {receiptData.notes && (
                  <div style={{ fontSize: '10px', color: '#333', marginTop: '3px', background: '#f1f5f9', padding: '2px 4px', borderRadius: '2px' }}>
                    {receiptData.notes}
                  </div>
                )}

                <hr className="receipt-divider" />

                {/* Items Table Header */}
                <div
                  className="receipt-row"
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    borderBottom: '1px solid #ddd',
                    paddingBottom: '4px',
                    marginBottom: '6px',
                  }}
                >
                  <span style={{ flex: 2 }}>ITEM / QTY</span>
                  <span style={{ flex: 1, textAlign: 'right' }}>PRICE</span>
                  <span style={{ flex: 1.2, textAlign: 'right' }}>TOTAL</span>
                </div>

                {/* Items List with Name, Price & Qty */}
                <div style={{ margin: '6px 0' }}>
                  {receiptData.items.map((item, idx) => {
                    const itemTotal = item.total || item.unitPrice * item.quantity;
                    return (
                      <div key={idx} style={{ marginBottom: '8px' }}>
                        <div className="receipt-row" style={{ alignItems: 'flex-start' }}>
                          <span style={{ flex: 2, fontWeight: 600, fontSize: '12px' }}>
                            {item.quantity}x {item.name}
                          </span>
                          <span style={{ flex: 1, textAlign: 'right', fontSize: '11px', color: '#555' }}>
                            {formatPKR(item.unitPrice)}
                          </span>
                          <span style={{ flex: 1.2, textAlign: 'right', fontWeight: 700, fontSize: '12px' }}>
                            {formatPKR(itemTotal)}
                          </span>
                        </div>
                        {item.notes && (
                          <div style={{ fontSize: '10px', color: '#666', fontStyle: 'italic', paddingLeft: '12px' }}>
                            * {item.notes}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <hr className="receipt-divider" />

                {/* Financial Summary */}
                <div className="receipt-row" style={{ fontSize: '12px' }}>
                  <span>Subtotal</span>
                  <span style={{ fontWeight: 600 }}>{formatPKR(receiptData.subtotal)}</span>
                </div>

                {receiptData.tax !== undefined && receiptData.tax > 0 && (
                  <div className="receipt-row" style={{ fontSize: '12px' }}>
                    <span>Tax {receiptData.taxRate ? `(${receiptData.taxRate}%)` : ''}</span>
                    <span style={{ fontWeight: 600 }}>{formatPKR(receiptData.tax)}</span>
                  </div>
                )}

                {receiptData.serviceCharge !== undefined && receiptData.serviceCharge > 0 && (
                  <div className="receipt-row" style={{ fontSize: '12px' }}>
                    <span>
                      Service Charges
                      {receiptData.serviceChargeRate ? ` (${receiptData.serviceChargeRate}%)` : ''}
                    </span>
                    <span style={{ fontWeight: 600 }}>{formatPKR(receiptData.serviceCharge)}</span>
                  </div>
                )}

                {receiptData.deliveryCharge !== undefined && receiptData.deliveryCharge > 0 && (
                  <div className="receipt-row" style={{ fontSize: '12px' }}>
                    <span>Delivery Charges</span>
                    <span style={{ fontWeight: 600 }}>{formatPKR(receiptData.deliveryCharge)}</span>
                  </div>
                )}

                {receiptData.tipAmount !== undefined && receiptData.tipAmount > 0 && (
                  <div className="receipt-row" style={{ fontSize: '12px' }}>
                    <span>Tip</span>
                    <span style={{ fontWeight: 600 }}>{formatPKR(receiptData.tipAmount)}</span>
                  </div>
                )}

                <hr className="receipt-double-divider" />

                <div className="receipt-row receipt-total-row">
                  <span>TOTAL AMOUNT</span>
                  <span>{formatPKR(receiptData.total)}</span>
                </div>

                <div className="receipt-row" style={{ marginTop: '8px', fontSize: '12px' }}>
                  <span>Payment Method</span>
                  <span style={{ fontWeight: 700 }}>{receiptData.paymentMethod || 'CASH'}</span>
                </div>

                {receiptData.totalPaid !== undefined && receiptData.totalPaid > 0 && (
                  <div className="receipt-row" style={{ fontSize: '12px' }}>
                    <span>Amount Tendered</span>
                    <span>{formatPKR(receiptData.totalPaid)}</span>
                  </div>
                )}

                {receiptData.change !== undefined && receiptData.change > 0 && (
                  <div className="receipt-row" style={{ fontSize: '12px', fontWeight: 700, color: '#000' }}>
                    <span>Change Returned</span>
                    <span>{formatPKR(receiptData.change)}</span>
                  </div>
                )}

                <hr className="receipt-divider" />

                <div className="receipt-footer">
                  <div style={{ fontWeight: 700 }}>Thank you for ordering with us!</div>
                  <div>Please visit again soon.</div>
                  <div style={{ marginTop: '6px', fontSize: '9px', letterSpacing: '0.1em' }}>
                    *** OFFICIAL CUSTOMER RECEIPT ***
                  </div>
                </div>
              </div>
            )}

            {/* Visual separator between slips when previewing both */}
            {activeTab === 'BOTH' && (
              <div
                className="no-print"
                style={{
                  textAlign: 'center',
                  margin: '20px 0',
                  color: 'var(--text-muted)',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <div style={{ flex: 1, height: '1px', background: 'var(--border-color)' }} />
                <span>✂️ THERMAL TEAR-OFF CUT LINE ✂️</span>
                <div style={{ flex: 1, height: '1px', background: 'var(--border-color)' }} />
              </div>
            )}

            {/* 2. KITCHEN ORDER TICKET (KOT) - ONLY ITEM & QTY, NO PRICES */}
            {(activeTab === 'BOTH' || activeTab === 'KITCHEN') && (
              <div className="kot-paper kitchen-slip" id="kitchen-ticket">
                <div className="kot-badge">🍳 KITCHEN COPY (KOT)</div>
                <div className="kot-header">
                  <div className="kot-title">KITCHEN ORDER TICKET</div>
                  <div className="kot-subtitle">*** PREPARATION COPY ***</div>
                </div>

                <hr className="kot-divider" />

                <div className="kot-meta-grid">
                  <div>
                    <span className="kot-label">TICKET #:</span>
                    <span className="kot-val highlight">#{orderNumStr}</span>
                  </div>
                  <div>
                    <span className="kot-label">ORDER TYPE:</span>
                    <span className="kot-val highlight">{typeDisplay.toUpperCase()}</span>
                  </div>
                  <div>
                    <span className="kot-label">TIME:</span>
                    <span className="kot-val">{formattedDate}</span>
                  </div>
                  <div>
                    <span className="kot-label">SERVER:</span>
                    <span className="kot-val">{receiptData.server || 'Server'}</span>
                  </div>
                </div>

                {receiptData.notes && (
                  <div className="kot-order-notes">
                    <strong>⚠️ ORDER DETAILS / INSTRUCTIONS:</strong> {receiptData.notes}
                  </div>
                )}

                <hr className="kot-divider" />

                {/* Items list: STRICTLY ITEM NAME AND QUANTITY (NO PRICES) */}
                <div className="kot-items-list">
                  <div className="kot-items-header">
                    <span>QTY</span>
                    <span>ITEM DESCRIPTION</span>
                  </div>

                  {receiptData.items.map((item, idx) => (
                    <div key={idx} className="kot-item-row">
                      <div className="kot-item-qty">{item.quantity}x</div>
                      <div className="kot-item-details">
                        <div className="kot-item-name">{item.name}</div>
                        {item.notes && (
                          <div className="kot-item-note">👉 {item.notes}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <hr className="kot-divider" />

                <div className="kot-footer">
                  <div style={{ fontSize: '13px', fontWeight: 800 }}>
                    TOTAL ITEMS: {receiptData.items.reduce((s, i) => s + i.quantity, 0)}
                  </div>
                  <div style={{ fontSize: '10px', marginTop: '4px', letterSpacing: '0.08em' }}>
                    *** END OF KITCHEN TICKET ***
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Print Actions Footer */}
        <div
          className="modal-footer no-print"
          style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}
        >
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary"
              onClick={() => handlePrint('CUSTOMER')}
              title="Print Customer Slip only"
            >
              🧾 Customer Slip
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => handlePrint('KITCHEN')}
              title="Print Kitchen Slip only"
            >
              🍳 Kitchen Slip (KOT)
            </button>
            <button
              className="btn btn-primary"
              onClick={() => handlePrint('BOTH')}
              title="Print Both Slips together"
            >
              🖨️ Print Both Slips
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReceiptModal;
