import React from 'react';
import { formatPKR } from '../../utils/format';
import type { ReceiptData } from '../../types/receipt.types';
import { getCachedReceiptBranding } from '../../lib/receiptBranding';

export type ReceiptPrintMode = 'BOTH' | 'CUSTOMER' | 'KITCHEN';

interface ReceiptSlipProps {
  receiptData: ReceiptData;
}

export function formatReceiptDate(date?: string | Date): string {
  if (!date) return new Date().toLocaleString('en-PK');
  return new Date(date).toLocaleString('en-PK', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function getOrderNumber(receiptData: ReceiptData): string {
  return String(receiptData.orderNumber || receiptData.orderId?.slice(0, 6) || '101');
}

export const CustomerSlip: React.FC<ReceiptSlipProps> = ({ receiptData }) => {
  const formattedDate = formatReceiptDate(receiptData.date);
  const cachedRestaurant = getCachedReceiptBranding();
  const restaurantName = receiptData.restaurant?.name || cachedRestaurant?.name || 'Restaurant';
  const restaurantAddress = receiptData.restaurant?.address || cachedRestaurant?.address || '';
  const restaurantPhone = receiptData.restaurant?.phone || cachedRestaurant?.phone || '';
  const restaurantLogo = receiptData.restaurant?.logoUrl || cachedRestaurant?.logoUrl;
  const orderNumStr = getOrderNumber(receiptData);
  const typeDisplay = receiptData.orderType || 'Dine In';

  return (
    <div className="receipt-paper customer-slip" id="customer-receipt">
      <div className="receipt-badge">CUSTOMER RECEIPT</div>
      <div className="receipt-header">
        {restaurantLogo && (
          <img
            className="receipt-restaurant-logo"
            src={restaurantLogo}
            alt=""
            style={{ width: '48px', height: '48px', objectFit: 'contain', marginBottom: '4px' }}
          />
        )}
        <div className="receipt-restaurant-name">{restaurantName}</div>
        {restaurantAddress && <div style={{ fontSize: '11px', color: '#444' }}>{restaurantAddress}</div>}
        {restaurantPhone && <div style={{ fontSize: '11px', color: '#444' }}>Tel: {restaurantPhone}</div>}
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
      {(receiptData.customerName || receiptData.customerPhone) && (
        <div style={{ marginTop: '3px' }}>
          {receiptData.customerName && (
            <div className="receipt-row" style={{ fontSize: '11px' }}>
              <span>Customer Name</span>
              <span style={{ fontWeight: 700 }}>{receiptData.customerName}</span>
            </div>
          )}
          {receiptData.customerPhone && (
            <div className="receipt-row" style={{ fontSize: '11px' }}>
              <span>Mobile No.</span>
              <span style={{ fontWeight: 700 }}>{receiptData.customerPhone}</span>
            </div>
          )}
        </div>
      )}
      {receiptData.notes && (
        <div
          style={{
            fontSize: '10px',
            color: '#333',
            marginTop: '3px',
            background: '#f1f5f9',
            padding: '2px 4px',
            borderRadius: '2px',
          }}
        >
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
              {item.dealComponents && item.dealComponents.length > 0 && (
                <div
                  style={{
                    fontSize: '10.5px',
                    color: '#444',
                    paddingLeft: '14px',
                    marginTop: '2px',
                    lineHeight: '1.3',
                  }}
                >
                  {item.dealComponents.map((comp, cIdx) => (
                    <div key={cIdx}>↳ {comp}</div>
                  ))}
                </div>
              )}
              {item.notes && (
                <div
                  style={{
                    fontSize: '10px',
                    color: '#666',
                    fontStyle: 'italic',
                    paddingLeft: '12px',
                    marginTop: '2px',
                  }}
                >
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
  );
};

export const KitchenSlip: React.FC<ReceiptSlipProps> = ({ receiptData }) => {
  const formattedDate = formatReceiptDate(receiptData.date);
  const orderNumStr = getOrderNumber(receiptData);
  const typeDisplay = receiptData.orderType || 'Dine In';

  return (
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
        {receiptData.customerName && (
          <div>
            <span className="kot-label">CUSTOMER:</span>
            <span className="kot-val">{receiptData.customerName}</span>
          </div>
        )}
        {receiptData.customerPhone && (
          <div>
            <span className="kot-label">MOBILE:</span>
            <span className="kot-val">{receiptData.customerPhone}</span>
          </div>
        )}
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
              {item.dealComponents && item.dealComponents.length > 0 && (
                <div
                  style={{
                    fontSize: '11px',
                    color: '#475569',
                    marginLeft: '4px',
                    marginTop: '2px',
                    fontStyle: 'italic',
                  }}
                >
                  {item.dealComponents.map((comp, cIdx) => (
                    <div key={cIdx}>↳ {comp}</div>
                  ))}
                </div>
              )}
              {item.notes && <div className="kot-item-note">👉 {item.notes}</div>}
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
  );
};

interface ReceiptPrintContentProps extends ReceiptSlipProps {
  mode: ReceiptPrintMode;
}

/**
 * The document body used by the hidden print iframe. It contains ONLY the
 * requested slips, so the browser never has to paginate the rest of the app.
 */
export const ReceiptPrintContent: React.FC<ReceiptPrintContentProps> = ({ receiptData, mode }) => (
  <div className="print-document">
    {(mode === 'BOTH' || mode === 'CUSTOMER') && (
      <div className="print-slip">
        <CustomerSlip receiptData={receiptData} />
      </div>
    )}
    {(mode === 'BOTH' || mode === 'KITCHEN') && (
      <div className="print-slip">
        <KitchenSlip receiptData={receiptData} />
      </div>
    )}
  </div>
);
