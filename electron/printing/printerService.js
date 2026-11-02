'use strict';

const { HELPER_APP_ID, HELPER_VERSION, DEFAULT_COLUMNS } = require('./constants');
const { buildReceiptEscPos, buildTestEscPos } = require('./escpos');
const { listPrinters: listWindowsPrinters, sendRawToPrinter } = require('./rawPrinter');
const { loadSettings, saveSettings } = require('./settings');

const PRINT_MODES = new Set(['BOTH', 'CUSTOMER', 'KITCHEN']);

/**
 * Shared print service used by both the standalone print helper and the
 * offline Electron POS. Keeping the ESC/POS + RAW logic here means both apps
 * print through exactly the same path.
 */
function createPrinterService(options = {}) {
  const userDataPath = options.userDataPath;
  const sendRaw = options.sendRaw || sendRawToPrinter;
  const list = options.listPrinters || listWindowsPrinters;

  let settings = loadSettings(userDataPath);
  let lastPrintAt = null;
  let lastError = null;

  function getSettings() {
    return { ...settings };
  }

  function updateSettings(nextSettings = {}) {
    settings = saveSettings(userDataPath, { ...settings, ...nextSettings });
    return getSettings();
  }

  function reloadSettings() {
    settings = loadSettings(userDataPath);
    return getSettings();
  }

  function getStatus() {
    return {
      ok: true,
      app: HELPER_APP_ID,
      version: HELPER_VERSION,
      printerName: settings.printerName || '',
      configured: Boolean(settings.printerName),
      platform: process.platform,
      lastPrintAt,
      lastError,
    };
  }

  function requirePrinter() {
    if (!settings.printerName) {
      throw new Error('No printer is configured. Open the print helper settings and select a printer.');
    }
  }

  async function print(payload = {}) {
    requirePrinter();

    const receipt = payload.receipt;
    if (!receipt || typeof receipt !== 'object' || !Array.isArray(receipt.items)) {
      throw new Error('Invalid receipt data. Expected a receipt object with an items array.');
    }

    const mode = PRINT_MODES.has(payload.mode) ? payload.mode : 'BOTH';
    const columns = settings.columns || DEFAULT_COLUMNS;
    const buffer = buildReceiptEscPos(receipt, {
      mode,
      openDrawer: Boolean(payload.openDrawer),
      columns,
    });

    try {
      await sendRaw(settings.printerName, buffer);
      lastPrintAt = new Date().toISOString();
      lastError = null;
      return {
        ok: true,
        message: `Printed ${mode === 'BOTH' ? 'customer + kitchen slips' : mode.toLowerCase() + ' slip'} to ${settings.printerName}.`,
        printerName: settings.printerName,
        bytes: buffer.length,
      };
    } catch (error) {
      lastError = error.message;
      throw error;
    }
  }

  async function testPrint() {
    requirePrinter();

    const buffer = buildTestEscPos({
      printerName: settings.printerName,
      columns: settings.columns || DEFAULT_COLUMNS,
    });

    try {
      await sendRaw(settings.printerName, buffer);
      lastPrintAt = new Date().toISOString();
      lastError = null;
      return {
        ok: true,
        message: `Test receipt sent to ${settings.printerName}.`,
        printerName: settings.printerName,
        bytes: buffer.length,
      };
    } catch (error) {
      lastError = error.message;
      throw error;
    }
  }

  async function getPrinters() {
    return list();
  }

  return {
    getSettings,
    updateSettings,
    reloadSettings,
    getStatus,
    print,
    testPrint,
    getPrinters,
  };
}

module.exports = { createPrinterService };
