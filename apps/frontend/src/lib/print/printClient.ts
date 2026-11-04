import type { ReceiptPrintMode } from '../../components/receipt/ReceiptSlips';
import type { ReceiptData } from '../../types/receipt.types';
import { buildReceiptEscPos, bytesToBase64 } from './escpos';
import type { EscPosOptions } from './escpos';

interface PrintHelperStatus {
  ok: boolean;
  app?: string;
  version?: string;
  printerName?: string;
  configured?: boolean;
  platform?: string;
  via: 'helper' | 'electron';
}

export type PrintRenderMode = 'raster' | 'text';

export interface DirectPrintOptions extends EscPosOptions {
  openDrawer?: boolean;
  /** OS printer name — used by the agent/helper/electron channels. */
  printerName?: string;
  /** 'raster' = pixel-exact preview image; 'text' = fast native ESC/POS text. */
  renderMode?: PrintRenderMode;
}

export interface DirectPrintResult {
  ok: boolean;
  via: 'helper' | 'electron' | 'agent';
  message?: string;
}

const DEFAULT_HELPER_URL = 'http://127.0.0.1:17777';
const DEFAULT_AGENT_URL = 'http://127.0.0.1:17778';
const DEFAULT_HELPER_TOKEN = 'rpos-print-2026-9f4c7b1e';
const HELPER_APP_ID = 'restaurant-pos-print-helper';
const AGENT_APP_ID = 'local-print-agent';
const URL_STORAGE_KEY = 'pos.printHelper.url';
const TOKEN_STORAGE_KEY = 'pos.printHelper.token';
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

function getPrintHelperConfig(): { url: string; token: string } {
  const envUrl = import.meta.env.VITE_PRINT_HELPER_URL || DEFAULT_HELPER_URL;
  const envToken = import.meta.env.VITE_PRINT_HELPER_TOKEN || DEFAULT_HELPER_TOKEN;
  const url = (readStorage(URL_STORAGE_KEY) || envUrl).replace(/\/+$/, '');
  const token = readStorage(TOKEN_STORAGE_KEY) || envToken;
  return { url, token };
}

function getPrintAgentConfig(): { url: string; token: string } {
  const envUrl = import.meta.env.VITE_PRINT_AGENT_URL || DEFAULT_AGENT_URL;
  const url = (readStorage(AGENT_URL_STORAGE_KEY) || envUrl).replace(/\/+$/, '');
  const token = readStorage(AGENT_TOKEN_STORAGE_KEY) || '';
  return { url, token };
}

type HttpPrintChannel = 'helper' | 'agent';

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

async function probeHelper(): Promise<boolean> {
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
    if (!response.ok) return false;
    const data = await response.json().catch(() => null);
    return data?.ok === true && data.app === HELPER_APP_ID;
  } catch {
    return false;
  }
}

/**
 * Probes the standalone print agent and the Windows print helper in parallel.
 * The agent is preferred when both are installed.
 */
async function detectHttpPrintChannel(): Promise<HttpPrintChannel | null> {
  const [agentUp, helperUp] = await Promise.all([probeAgent(), probeHelper()]);
  if (agentUp) return 'agent';
  if (helperUp) return 'helper';
  return null;
}

export async function checkLocalPrintService(): Promise<boolean> {
  const electronPrint = getElectronPrintApi();
  if (electronPrint?.status) {
    try {
      const status = await electronPrint.status();
      if (status?.ok) return true;
    } catch {
      // Fall through to the HTTP services.
    }
  }
  return (await detectHttpPrintChannel()) !== null;
}

function getElectronPrintApi() {
  return typeof window !== 'undefined' && window.electronAPI?.platform === 'win32'
    ? window.electronAPI.print
    : undefined;
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
async function checkPrintHelper(): Promise<PrintHelperStatus | null> {
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

const SERVICE_UNAVAILABLE_MESSAGE =
  'Local print service is unavailable. Install and start the local print service, then retry.';

/**
 * Sends receipt JSON to the best available print channel:
 * Electron IPC -> print helper -> generic print agent.
 * Throws when no channel can print; never opens a browser dialog.
 */
export async function printReceiptDirect(
  receiptData: ReceiptData,
  mode: ReceiptPrintMode,
  options: DirectPrintOptions = {}
): Promise<DirectPrintResult> {
  // raster = render the actual slip preview to a bitmap (what you see is what
  // prints); text = the native ESC/POS text builder. Raster falls back to text
  // if rendering is unavailable.
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

  const payload = {
    receipt: receiptData,
    mode,
    openDrawer: Boolean(options.openDrawer),
    printerName: options.printerName,
    dataBase64,
  };

  const electronPrint = getElectronPrintApi();
  if (electronPrint?.printReceipt) {
    const result = await electronPrint.printReceipt(payload);
    if (result?.ok) {
      return { ok: true, via: 'electron', message: result.message };
    }
    throw new Error(result?.error || 'The desktop print service could not print the receipt.');
  }

  const channel = await detectHttpPrintChannel();

  if (channel === 'helper') {
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

  if (channel === 'agent') {
    if (!dataBase64) throw new Error('Could not render the receipt for printing.');
    const { url, token } = getPrintAgentConfig();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['X-Print-Token'] = token;
    const agentResponse = await fetchWithTimeout(
      `${url}/print`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          printer: options.printerName,
          dataBase64,
        }),
      },
      15000
    );
    const agentData = await agentResponse.json().catch(() => ({}));
    if (!agentResponse.ok || !agentData?.success) {
      throw new Error(agentData?.error || `Local print agent returned HTTP ${agentResponse.status}.`);
    }

    return {
      ok: true,
      via: 'agent',
      message: `Printed to ${agentData.printer || options.printerName || 'the selected printer'}.`,
    };
  }

  throw new Error(SERVICE_UNAVAILABLE_MESSAGE);
}

export async function listPrintHelperPrinters(): Promise<AvailablePrinter[]> {
  const electronPrint = getElectronPrintApi();
  if (electronPrint?.listPrinters) {
    const printers = await electronPrint.listPrinters();
    if (Array.isArray(printers) && printers.length > 0) {
      const status = await checkPrintHelper();
      return printers.map((name) => ({
        name,
        isDefault: name === status?.printerName,
      }));
    }
  }

  const channel = await detectHttpPrintChannel();

  if (channel === 'helper') {
    const { url, token } = getPrintHelperConfig();
    const helperStatus = await checkPrintHelper();
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
    if (response.ok && data?.ok && Array.isArray(data.printers)) {
      return data.printers
        .filter((name: unknown): name is string => typeof name === 'string')
        .map((name: string) => ({ name, isDefault: name === helperStatus?.printerName }));
    }
  }

  if (channel === 'agent') {
    const { url } = getPrintAgentConfig();
    const response = await fetchWithTimeout(
      `${url}/printers`,
      { method: 'GET', cache: 'no-store' },
      5000
    );
    const data = await response.json().catch(() => ({}));
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

  throw new Error(SERVICE_UNAVAILABLE_MESSAGE);
}
