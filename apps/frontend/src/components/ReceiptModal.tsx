import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReceiptData } from '../types/receipt.types';
import { CustomerSlip, KitchenSlip } from './receipt/ReceiptSlips';
import type { ReceiptPrintMode } from './receipt/ReceiptSlips';
import { printReceiptInBrowser } from '../lib/print/browserPrint';
import {
  checkLocalPrintService,
  listPrintHelperPrinters,
  printReceiptDirect,
} from '../lib/print/printClient';
import type { AvailablePrinter, PrintRenderMode } from '../lib/print/printClient';

export type { ReceiptData, ReceiptItem } from '../types/receipt.types';

const RENDER_MODE_KEY = 'pos.printRenderMode';

function readRenderMode(): PrintRenderMode {
  try {
    return window.localStorage.getItem(RENDER_MODE_KEY) === 'text' ? 'text' : 'raster';
  } catch {
    return 'raster';
  }
}

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
  const [printing, setPrinting] = useState(false);
  const [printNotice, setPrintNotice] = useState<string | null>(null);
  const [printers, setPrinters] = useState<AvailablePrinter[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState('');
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [printerError, setPrinterError] = useState<string | null>(null);
  const [renderMode, setRenderMode] = useState<PrintRenderMode>(readRenderMode);
  const androidBrowser = /Android/i.test(navigator.userAgent) && !window.electronAPI;
  const hostPlatform = window.electronAPI?.platform ||
    (/Windows/i.test(navigator.userAgent)
      ? 'win32'
      : /Linux/i.test(navigator.userAgent)
        ? 'linux'
        : /Mac OS X|Macintosh/i.test(navigator.userAgent)
          ? 'darwin'
          : '');
  const installerHref =
    hostPlatform === 'win32'
      ? '/print-service/install-windows.ps1'
      : hostPlatform === 'linux'
        ? '/print-service/install-linux.sh'
        : null;

  const refreshPrinters = useCallback(async () => {
    setLoadingPrinters(true);
    setPrinterError(null);
    try {
      const serviceAvailable = await checkLocalPrintService();
      if (!serviceAvailable) {
        setPrinters([]);
        setSelectedPrinter('');
        setPrinterError(
          'No running local print service was detected. If you already installed it, start or restart the service.'
        );
        return;
      }

      const availablePrinters = await listPrintHelperPrinters();
      setPrinters(availablePrinters);
      if (availablePrinters.length === 0) {
        setSelectedPrinter('');
        setPrinterError('The print service is running, but no installed printers were found.');
        return;
      }

      setSelectedPrinter((current) => {
        let savedPrinter = '';
        try {
          savedPrinter = window.localStorage.getItem('pos.selectedPrinterName') || '';
        } catch {
          // Use the detected default if browser storage is unavailable.
        }
        const preferred = current || savedPrinter;
        if (availablePrinters.some((printer) => printer.name === preferred)) return preferred;
        return (
          availablePrinters.find((printer) => printer.isDefault)?.name ||
          availablePrinters[0].name
        );
      });
    } catch (error) {
      setPrinters([]);
      setSelectedPrinter('');
      setPrinterError(
        error instanceof Error ? error.message : 'Could not load printers from the local print service.'
      );
    } finally {
      setLoadingPrinters(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && !androidBrowser) void refreshPrinters();
  }, [isOpen, androidBrowser, refreshPrinters]);

  if (!isOpen || !receiptData) return null;

  const handleSelectPrinter = (printerName: string) => {
    setSelectedPrinter(printerName);
    try {
      window.localStorage.setItem('pos.selectedPrinterName', printerName);
    } catch {
      // The current selection still works when browser storage is unavailable.
    }
  };

  const handlePrint = async (tabToPrint?: ReceiptPrintMode) => {
    const mode = tabToPrint || activeTab;
    if (tabToPrint) setActiveTab(tabToPrint);
    if (!receiptData || printing) return;

    setPrinting(true);
    setPrintNotice(null);

    try {
      if (androidBrowser) {
        await printReceiptInBrowser(receiptData, mode);
        setPrintNotice('Android print dialog opened.');
      } else {
        if (!selectedPrinter) throw new Error('Select an installed printer before printing.');
        const result = await printReceiptDirect(receiptData, mode, {
          printerName: selectedPrinter,
          renderMode,
        });
        setPrintNotice(result.message || `Sent directly to ${selectedPrinter}.`);
      }
    } catch (error) {
      console.error('[Print] Printing failed:', error);
      setPrintNotice(error instanceof Error ? error.message : 'Printing failed. Please try again.');
    } finally {
      setPrinting(false);
      window.setTimeout(() => setPrintNotice(null), 8000);
    }
  };

  const orderNumStr = String(receiptData.orderNumber || receiptData.orderId?.slice(0, 6) || '101');
  const typeDisplay = receiptData.orderType || 'Dine In';

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

        {/* Android uses the system print sheet; desktop browsers use the local print service. */}
        <div
          className="no-print"
          style={{
            padding: '10px 20px',
            fontSize: '11px',
            lineHeight: 1.6,
            color: 'var(--text-muted)',
            background: 'rgba(99, 102, 241, 0.06)',
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          {androidBrowser ? (
            <div style={{ color: 'var(--text-secondary)' }}>
              Android uses its system print dialog. Direct printing requires an Android print-service
              integration.
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <label htmlFor="receipt-printer" style={{ color: 'var(--text-secondary)' }}>
                Printer
              </label>
              <select
                id="receipt-printer"
                value={selectedPrinter}
                onChange={(event) => handleSelectPrinter(event.target.value)}
                disabled={loadingPrinters || printers.length === 0 || printing}
                style={{ minWidth: '220px', padding: '6px 8px' }}
              >
                {printers.length === 0 && <option value="">No printers found</option>}
                {printers.map((printer) => (
                  <option key={printer.name} value={printer.name}>
                    {printer.name}
                    {printer.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={refreshPrinters}
                disabled={loadingPrinters || printing}
              >
                {loadingPrinters ? 'Loading…' : 'Refresh'}
              </button>
              <label htmlFor="receipt-render-mode" style={{ color: 'var(--text-secondary)' }}>
                Style
              </label>
              <select
                id="receipt-render-mode"
                value={renderMode}
                onChange={(event) => {
                  const next = event.target.value as PrintRenderMode;
                  setRenderMode(next);
                  try {
                    window.localStorage.setItem(RENDER_MODE_KEY, next);
                  } catch {
                    // Selection still works when browser storage is unavailable.
                  }
                }}
                disabled={printing}
                style={{ padding: '6px 8px' }}
                title="Exact image = prints exactly what you see. Fast text = native printer fonts."
              >
                <option value="raster">Exact image</option>
                <option value="text">Fast text</option>
              </select>
            </div>
          )}
          {printerError && !androidBrowser && (
            <div style={{ marginTop: '6px', color: 'var(--text-secondary)' }}>
              {printerError}
              {hostPlatform === 'darwin' && (
                <div style={{ marginTop: '8px' }}>
                  <details>
                    <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}>
                      macOS setup instructions
                    </summary>
                    <ol style={{ margin: '6px 0 0', paddingLeft: '20px' }}>
                      <li>
                        Download the macOS print-agent binary from the{' '}
                        <a
                          href="https://github.com/ammarshameer/restaurant-pos-system/releases"
                          target="_blank"
                          rel="noreferrer"
                        >
                          releases page
                        </a>{' '}
                        (local-print-agent-darwin-arm64 or -amd64).
                      </li>
                      <li>
                        Make it executable and run it:{' '}
                        <code>chmod +x local-print-agent-* &amp;&amp; ./local-print-agent-*</code>
                      </li>
                      <li>Refresh this printer list once it is running.</li>
                    </ol>
                  </details>
                </div>
              )}
              {installerHref && (
                <div style={{ marginTop: '8px' }}>
                  <a
                    className="btn btn-primary btn-sm"
                    href={installerHref}
                    download={
                      hostPlatform === 'win32'
                        ? 'local-print-agent-install.ps1'
                        : 'local-print-agent-install.sh'
                    }
                    style={{ textDecoration: 'none' }}
                  >
                    Download {hostPlatform === 'win32' ? 'Windows' : 'Linux'} installer
                  </a>
                  <details style={{ marginTop: '8px' }}>
                    <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}>
                      Installation instructions
                    </summary>
                    {hostPlatform === 'win32' ? (
                      <ol style={{ margin: '6px 0 0', paddingLeft: '20px' }}>
                        <li>Download the PowerShell installer above.</li>
                        <li>
                          Open <strong>PowerShell as Administrator</strong>.
                        </li>
                        <li>
                          Run:{' '}
                          <code>
                            Set-ExecutionPolicy -Scope Process Bypass; &amp;
                            "$env:USERPROFILE\Downloads\local-print-agent-install.ps1"
                          </code>
                        </li>
                      </ol>
                    ) : (
                      <ol style={{ margin: '6px 0 0', paddingLeft: '20px' }}>
                        <li>Download the Linux installer above.</li>
                        <li>Open Terminal in your Downloads folder.</li>
                        <li>
                          Run: <code>sudo bash local-print-agent-install.sh</code>
                        </li>
                      </ol>
                    )}
                    <div style={{ marginTop: '6px' }}>
                      The installer registers a service that starts automatically with the
                      computer. Refresh this printer list when it finishes.
                    </div>
                  </details>
                </div>
              )}
            </div>
          )}
          {printNotice && (
            <div style={{ marginTop: '6px', color: 'var(--text-secondary)' }}>{printNotice}</div>
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

        {/* Modal Print Actions Footer — single row; the ✕ in the header closes the modal. */}
        <div
          className="modal-footer no-print"
          style={{ display: 'flex', gap: '6px' }}
        >
          <button
            className="btn btn-secondary btn-sm"
            style={{ flex: 1, whiteSpace: 'nowrap', padding: '6px 4px', fontSize: '12px' }}
            onClick={() => handlePrint('CUSTOMER')}
            title="Print Customer Slip only"
            disabled={printing || (!androidBrowser && (!selectedPrinter || loadingPrinters))}
          >
            🧾 Customer Slip
          </button>
          <button
            className="btn btn-secondary btn-sm"
            style={{ flex: 1, whiteSpace: 'nowrap', padding: '6px 4px', fontSize: '12px' }}
            onClick={() => handlePrint('KITCHEN')}
            title="Print Kitchen Slip only"
            disabled={printing || (!androidBrowser && (!selectedPrinter || loadingPrinters))}
          >
            🍳 Kitchen Slip (KOT)
          </button>
          <button
            className="btn btn-primary btn-sm"
            style={{ flex: 1, whiteSpace: 'nowrap', padding: '6px 4px', fontSize: '12px' }}
            onClick={() => handlePrint('BOTH')}
            title="Print Both Slips together"
            disabled={printing || (!androidBrowser && (!selectedPrinter || loadingPrinters))}
          >
            {printing ? '⏳ Printing…' : '🖨️ Print Both Slips'}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalPortal, document.body);
};

export default ReceiptModal;
