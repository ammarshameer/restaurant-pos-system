import type { ReceiptPrintMode } from '../../components/receipt/ReceiptSlips';
import type { ReceiptData } from '../../types/receipt.types';
import { buildReceiptEscPos, bytesToBase64 } from './escpos';
import type { EscPosOptions } from './escpos';

export type PrintRenderMode = 'raster' | 'text';

export interface DirectPrintOptions extends EscPosOptions {
  openDrawer?: boolean;
  /** OS printer name — used by the local print agent. */
  printerName?: string;
  /** 'raster' = pixel-exact preview image; 'text' = fast native ESC/POS text. */
  renderMode?: PrintRenderMode;
}

export interface DirectPrintResult {
  ok: boolean;
  via: 'agent';
  message?: string;
}

const DEFAULT_AGENT_URL = 'http://127.0.0.1:17778';
const AGENT_APP_ID = 'local-print-agent';
const AGENT_URL_STORAGE_KEY = 'pos.printAgent.url';
const AGENT_TOKEN_STORAGE_KEY = 'pos.printAgent.token';

export interface AvailablePrinter {
  name: string;
  isDefault: boolean;
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be disabled; settings simply will not persist.
  }
}

export interface PrintAgentConfig {
  url: string;
  token: string;
}

export function getPrintAgentConfig(): PrintAgentConfig {
  const envUrl = import.meta.env.VITE_PRINT_AGENT_URL || DEFAULT_AGENT_URL;
  const envToken = import.meta.env.VITE_PRINT_AGENT_TOKEN || '';
  const url = (readStorage(AGENT_URL_STORAGE_KEY) ?? envUrl).replace(/\/+$/, '');
  const token = (readStorage(AGENT_TOKEN_STORAGE_KEY) ?? envToken).trim();
  return { url, token };
}

/** Called by POS Settings after the installer displays the one-time token. */
export function savePrintAgentConfig(url: string, token: string): void {
  writeStorage(AGENT_URL_STORAGE_KEY, url.trim().replace(/\/+$/, ''));
  writeStorage(AGENT_TOKEN_STORAGE_KEY, token.trim());
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 2500
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

async function probeAgent(): Promise<boolean> {
  const { url } = getPrintAgentConfig();
  try {
    const response = await fetchWithTimeout(
      `${url}/health`,
      { method: 'GET', cache: 'no-store' },
      2000
    );
    if (!response.ok) return false;
    const data = await response.json().catch(() => null);
    // The app id identifies the bridge even if a foreign app owns the port.
    return data?.success === true && data?.app === AGENT_APP_ID;
  } catch {
    return false;
  }
}

export async function checkLocalPrintService(): Promise<boolean> {
  return probeAgent();
}

/**
 * Renders the receipt and sends the raw bytes to the local print agent.
 * The agent requires the installer-generated token on every print request.
 */
export async function printReceiptDirect(
  receiptData: ReceiptData,
  mode: ReceiptPrintMode,
  options: DirectPrintOptions = {}
): Promise<DirectPrintResult> {
  let dataBase64: string | undefined;
  const buildText = () => bytesToBase64(buildReceiptEscPos(receiptData, mode, options));
  if (options.renderMode === 'text') {
    dataBase64 = buildText();
  } else {
    try {
      // Lazy-loaded: the ~200KB raster renderer is only fetched when printing.
      const { buildReceiptRasterEscPos } = await import('./rasterize');
      dataBase64 = bytesToBase64(await buildReceiptRasterEscPos(receiptData, mode, options));
    } catch {
      try {
        dataBase64 = buildText();
      } catch {
        dataBase64 = undefined;
      }
    }
  }
  if (!dataBase64) throw new Error('Could not render the receipt for printing.');

  const { url, token } = getPrintAgentConfig();
  const response = await fetchWithTimeout(
    `${url}/print`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Print-Token': token,
      },
      body: JSON.stringify({
        printer: options.printerName,
        dataBase64,
      }),
    },
    15000
  );
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    throw new Error('Print agent token is missing or incorrect. Enter it in POS Settings > Local print service.');
  }
  if (!response.ok || !data?.success) {
    throw new Error(data?.error || `Local print agent returned HTTP ${response.status}.`);
  }

  return {
    ok: true,
    via: 'agent',
    message: `Printed to ${data.printer || options.printerName || 'the selected printer'}.`,
  };
}

export async function listLocalPrintPrinters(): Promise<AvailablePrinter[]> {
  const { url, token } = getPrintAgentConfig();
  const response = await fetchWithTimeout(
    `${url}/printers`,
    {
      method: 'GET',
      cache: 'no-store',
      headers: { 'X-Print-Token': token },
    },
    5000
  );
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    throw new Error('Print agent token is missing or incorrect. Enter it in POS Settings > Local print service.');
  }
  if (!response.ok || !data?.success || !Array.isArray(data.printers)) {
    throw new Error(data?.error || 'Could not load printers from the local print service.');
  }

  return data.printers
    .filter((printer: unknown): printer is { name: string; default?: boolean } =>
      Boolean(
        printer &&
          typeof printer === 'object' &&
          'name' in printer &&
          typeof printer.name === 'string'
      )
    )
    .map((printer: { name: string; default?: boolean }) => ({
      name: printer.name,
      isDefault: Boolean(printer.default),
    }));
}
