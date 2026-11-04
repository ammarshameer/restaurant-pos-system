import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReceiptData } from '../types/receipt.types';
import { CustomerSlip, KitchenSlip } from './receipt/ReceiptSlips';
import type { ReceiptPrintMode } from './receipt/ReceiptSlips';
import { printReceiptInBrowser } from '../lib/print/browserPrint';
import {
  checkPrintHelper,
  openPrintHelperSettings,
  printReceiptDirect,
} from '../lib/print/printClient';
import type { PrintHelperStatus } from '../lib/print/printClient';

export type { ReceiptData, ReceiptItem } from '../types/receipt.types';

interface ReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  receiptData: ReceiptData | null;
  defaultTab?: ReceiptPrintMode;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  isOpen,
  onClose,
  receiptData,
  defaultTab = 'BOTH',
}) => {
  const [activeTab, setActiveTab] = useState<ReceiptPrintMode>(defaultTab);
  const [helperStatus, setHelperStatus] = useState<PrintHelperStatus | null>(null);
  const [checkingHelper, setCheckingHelper] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [openDrawer, setOpenDrawer] = useState(false);
  const [printNotice, setPrintNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setCheckingHelper(true);
    checkPrintHelper()
      .then((status) => {
        if (!cancelled) setHelperStatus(status);
      })
      .catch(() => {
        if (!cancelled) setHelperStatus(null);
      })
      .finally(() => {
        if (!cancelled) setCheckingHelper(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen || !receiptData) return null;

  const refreshHelperStatus = async () => {
    setCheckingHelper(true);
    try {
      setHelperStatus(await checkPrintHelper());
    } finally {
      setCheckingHelper(false);
    }
  };

  const handleOpenPrinterSettings = async () => {
    const opened = await openPrintHelperSettings();
    if (opened) {
      window.setTimeout(refreshHelperStatus, 1000);
    }
  };

  const handlePrint = async (tabToPrint?: ReceiptPrintMode) => {
    const mode = tabToPrint || activeTab;
    if (tabToPrint) setActiveTab(tabToPrint);
    if (!receiptData || printing) return;

    setPrinting(true);
    setPrintNotice(null);

    try {
      // Prefer the local print helper / offline Electron print bridge.
      try {
        const result = await printReceiptDirect(receiptData, mode, { openDrawer });
        if (result.ok) {
          setPrintNotice(
            result.via === 'electron'
              ? '✅ Printed directly from the desktop app.'
              : `✅ Printed directly to ${helperStatus?.printerName || 'the thermal printer'}.`
          );
          return;
        }
      } catch (directError) {
        console.warn('[Print] Direct printing unavailable, falling back to browser print:', directError);
      }

      // Fallback: print only the receipt from a dedicated 72 mm document.
      await printReceiptInBrowser(receiptData, mode);
      setPrintNotice('🖨️ Opened the browser print dialog. Select your 80 mm thermal printer.');
    } catch (error) {
      console.error('[Print] Printing failed:', error);
      setPrintNotice('❌ Printing failed. Please check the printer and try again.');
    } finally {
      setPrinting(false);
      window.setTimeout(() => setPrintNotice(null), 8000);
    }
  };

  const orderNumStr = String(receiptData.orderNumber || receiptData.orderId?.slice(0, 6) || '101');
  const typeDisplay = receiptData.orderType || 'Dine In';

  const helperLabel = checkingHelper
    ? 'Checking for the direct print helper…'
    : helperStatus
      ? helperStatus.configured === false || !helperStatus.printerName
        ? '🟡 Print helper connected — set a printer in the helper settings.'
        : `✅ Direct printer ready${helperStatus.printerName ? ` — ${helperStatus.printerName}` : ''}`
      : '⚪ Direct print helper not detected — browser printing will be used.';

  // Portal the modal directly to <body> so it sits above the app shell.
  const modalPortal = (
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

        {/* Direct-print status + fallback guide (screen only) */}
        <div
          className="no-print"
          style={{
            padding: '10px 20px',
            fontSize: '11px',
            lineHeight: 1.6,
            color: 'var(--text-muted)',
            background: 'rgba(var(--primary-rgb), 0.06)',
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <strong style={{ color: 'var(--text-secondary)' }}>{helperLabel}</strong>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={refreshHelperStatus}
              disabled={checkingHelper || printing}
            >
              Refresh
            </button>
            {helperStatus?.via === 'electron' && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleOpenPrinterSettings}
                disabled={printing}
              >
                Printer settings
              </button>
            )}
          </div>
          {printNotice && (
            <div style={{ marginTop: '6px', color: 'var(--text-secondary)' }}>{printNotice}</div>
          )}
          {!helperStatus && (
            <div style={{ marginTop: '6px' }}>
              Browser fallback: in the print dialog choose the thermal printer, its{' '}
              <strong>80 mm Receipt/Roll</strong> paper, <strong>Margins = None</strong>,{' '}
              <strong>Scale = 100%</strong>, and uncheck <strong>Headers and footers</strong>.
            </div>
          )}
        </div>

        <div className="modal-body" style={{ padding: '20px', overflowY: 'auto', maxHeight: '65vh' }}>
          <div className="print-slips-container">
            {/* 1. CUSTOMER RECEIPT (Rendered if BOTH or CUSTOMER active) */}
            {(activeTab === 'BOTH' || activeTab === 'CUSTOMER') && (
              <CustomerSlip receiptData={receiptData} />
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
              <KitchenSlip receiptData={receiptData} />
            )}
          </div>
        </div>

        {/* Modal Print Actions Footer */}
        <div
          className="modal-footer no-print"
          style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}
        >
          <button className="btn btn-secondary" onClick={onClose} disabled={printing}>
            Close
          </button>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                color: 'var(--text-secondary)',
                cursor: helperStatus ? 'pointer' : 'not-allowed',
              }}
              title="Open the cash drawer after the customer slip (direct printing only)"
            >
              <input
                type="checkbox"
                checked={openDrawer}
                onChange={(e) => setOpenDrawer(e.target.checked)}
                disabled={!helperStatus || printing}
              />
              Open cash drawer
            </label>
            <button
              className="btn btn-secondary"
              onClick={() => handlePrint('CUSTOMER')}
              title="Print Customer Slip only"
              disabled={printing}
            >
              🧾 Customer Slip
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => handlePrint('KITCHEN')}
              title="Print Kitchen Slip only"
              disabled={printing}
            >
              🍳 Kitchen Slip (KOT)
            </button>
            <button
              className="btn btn-primary"
              onClick={() => handlePrint('BOTH')}
              title="Print Both Slips together"
              disabled={printing}
            >
              {printing ? '⏳ Printing…' : '🖨️ Print Both Slips'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalPortal, document.body);
};

export default ReceiptModal;
