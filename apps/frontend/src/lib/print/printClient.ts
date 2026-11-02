import type { ReceiptPrintMode } from '../../components/receipt/ReceiptSlips';
import type { ReceiptData } from '../../types/receipt.types';

export interface PrintHelperStatus {
  ok: boolean;
  app?: string;
  version?: string;
  printerName?: string;
  configured?: boolean;
  platform?: string;
  via: 'helper' | 'electron';
}

export interface DirectPrintOptions {
  openDrawer?: boolean;
}

export interface DirectPrintResult {
  ok: boolean;
  via: 'helper' | 'electron';
  message?: string;
}

const DEFAULT_HELPER_URL = 'http://127.0.0.1:17777';
const DEFAULT_HELPER_TOKEN = 'rpos-print-2026-9f4c7b1e';
const HELPER_APP_ID = 'restaurant-pos-print-helper';
const URL_STORAGE_KEY = 'pos.printHelper.url';
const TOKEN_STORAGE_KEY = 'pos.printHelper.token';

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function getPrintHelperConfig(): { url: string; token: string } {
  const envUrl = import.meta.env.VITE_PRINT_HELPER_URL || DEFAULT_HELPER_URL;
  const envToken = import.meta.env.VITE_PRINT_HELPER_TOKEN || DEFAULT_HELPER_TOKEN;
  const url = (readStorage(URL_STORAGE_KEY) || envUrl).replace(/\/+$/, '');
  const token = readStorage(TOKEN_STORAGE_KEY) || envToken;
  return { url, token };
}

export function setPrintHelperConfig(config: { url?: string; token?: string }): void {
  try {
    if (config.url !== undefined) {
      window.localStorage.setItem(URL_STORAGE_KEY, config.url.replace(/\/+$/, ''));
    }
    if (config.token !== undefined) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, config.token);
    }
  } catch {
    // localStorage can be unavailable in private/incognito contexts.
  }
}

function getElectronPrintApi() {
  return typeof window !== 'undefined' ? window.electronAPI?.print : undefined;
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

/**
 * Checks for the desktop print service. In the offline Electron build this is
 * the preload IPC bridge; on the hosted site it is the loopback HTTP helper.
 */
export async function checkPrintHelper(): Promise<PrintHelperStatus | null> {
  const electronPrint = getElectronPrintApi();
  if (electronPrint?.status) {
    try {
      const status = await electronPrint.status();
      if (status?.ok) return { ...status, via: 'electron' };
    } catch {
      // Fall through to the HTTP helper check.
    }
  }

  const { url, token } = getPrintHelperConfig();
  try {
    const response = await fetchWithTimeout(
      `${url}/status`,
      {
        method: 'GET',
        cache: 'no-store',
        headers: { 'X-Print-Token': token },
      },
      2000
    );

    if (!response.ok) return null;

    const data = await response.json().catch(() => null);
    if (!data?.ok || data.app !== HELPER_APP_ID) return null;
    return { ...data, via: 'helper' };
  } catch {
    // Connection refused / CORS blocked / helper not running.
    return null;
  }
}

/**
 * Sends receipt JSON to the local helper. The helper builds ESC/POS and writes
 * it to the Windows printer in RAW mode. Throws when direct printing is not
 * available so the caller can fall back to browser printing.
 */
export async function printReceiptDirect(
  receiptData: ReceiptData,
  mode: ReceiptPrintMode,
  options: DirectPrintOptions = {}
): Promise<DirectPrintResult> {
  const payload = {
    receipt: receiptData,
    mode,
    openDrawer: Boolean(options.openDrawer),
  };

  const electronPrint = getElectronPrintApi();
  if (electronPrint?.printReceipt) {
    const result = await electronPrint.printReceipt(payload);
    if (result?.ok) {
      return { ok: true, via: 'electron', message: result.message };
    }
    throw new Error(result?.error || 'The desktop print service could not print the receipt.');
  }

  const { url, token } = getPrintHelperConfig();
  const response = await fetchWithTimeout(
    `${url}/print`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Print-Token': token,
      },
      body: JSON.stringify(payload),
    },
    15000
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || `Print helper returned HTTP ${response.status}.`);
  }

  return { ok: true, via: 'helper', message: data.message };
}

export async function testPrintHelper(): Promise<DirectPrintResult> {
  const electronPrint = getElectronPrintApi();
  if (electronPrint?.testPrint) {
    const result = await electronPrint.testPrint();
    if (result?.ok) return { ok: true, via: 'electron', message: result.message };
    throw new Error(result?.error || 'The desktop print service could not print the test page.');
  }

  const { url, token } = getPrintHelperConfig();
  const response = await fetchWithTimeout(
    `${url}/test-print`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Print-Token': token,
      },
      body: JSON.stringify({}),
    },
    15000
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || `Print helper returned HTTP ${response.status}.`);
  }

  return { ok: true, via: 'helper', message: data.message };
}

export async function openPrintHelperSettings(): Promise<boolean> {
  const electronPrint = getElectronPrintApi();
  if (electronPrint?.openSettings) {
    await electronPrint.openSettings();
    return true;
  }
  return false;
}

export async function listPrintHelperPrinters(): Promise<string[]> {
  const electronPrint = getElectronPrintApi();
  if (electronPrint?.listPrinters) {
    const printers = await electronPrint.listPrinters();
    if (Array.isArray(printers)) return printers;
  }

  const { url, token } = getPrintHelperConfig();
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
  if (!response.ok || !data?.ok || !Array.isArray(data.printers)) return [];
  return data.printers;
}
