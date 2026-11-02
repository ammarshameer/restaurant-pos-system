'use strict';

/**
 * Settings window shared by the standalone print helper (HTTP transport) and
 * the offline Electron POS (IPC transport). Both expose the same
 * `window.printHelper` bridge through their preload script.
 */

const api = window.printHelper;

const elements = {
  statusBadge: document.getElementById('status-badge'),
  statusBadgeText: document.getElementById('status-badge-text'),
  printerSelect: document.getElementById('printer-select'),
  printerName: document.getElementById('printer-name'),
  printerHelp: document.getElementById('printer-help'),
  refreshPrinters: document.getElementById('refresh-printers'),
  columns: document.getElementById('columns'),
  saveSettings: document.getElementById('save-settings'),
  testPrint: document.getElementById('test-print'),
  notice: document.getElementById('notice'),
  transportLabel: document.getElementById('transport-label'),
  portLabel: document.getElementById('port-label'),
  endpointLabel: document.getElementById('endpoint-label'),
  versionLabel: document.getElementById('version-label'),
  tokenField: document.getElementById('token-field'),
  token: document.getElementById('token'),
  origins: document.getElementById('origins'),
};

let state = null;
let noticeTimer = null;

function showNotice(message, kind = 'info') {
  if (!elements.notice) return;
  elements.notice.textContent = message;
  elements.notice.dataset.kind = kind;

  if (noticeTimer) window.clearTimeout(noticeTimer);
  if (kind !== 'error') {
    noticeTimer = window.setTimeout(() => {
      elements.notice.dataset.kind = '';
      elements.notice.textContent = '';
    }, 6000);
  }
}

function setBusy(busy) {
  for (const button of [elements.saveSettings, elements.testPrint, elements.refreshPrinters]) {
    if (button) button.disabled = busy;
  }
}

function renderStatus(status) {
  const configured = Boolean(status && status.printerName);

  if (!status || status.ok === false) {
    elements.statusBadge.dataset.state = 'error';
    elements.statusBadgeText.textContent = 'Service unavailable';
    return;
  }

  if (!configured) {
    elements.statusBadge.dataset.state = 'warning';
    elements.statusBadgeText.textContent = 'Printer not set';
    return;
  }

  if (status.lastError) {
    elements.statusBadge.dataset.state = 'error';
    elements.statusBadgeText.textContent = 'Last print failed';
    return;
  }

  elements.statusBadge.dataset.state = 'ready';
  elements.statusBadgeText.textContent = 'Ready to print';
}

function renderPrinters(printers, selectedName, errorMessage) {
  const select = elements.printerSelect;
  if (!select) return;

  select.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = printers.length ? 'Select a printer…' : 'No printers found';
  select.appendChild(placeholder);

  for (const printer of printers) {
    const option = document.createElement('option');
    option.value = printer;
    option.textContent = printer;
    if (printer === selectedName) option.selected = true;
    select.appendChild(option);
  }

  if (elements.printerHelp) {
    elements.printerHelp.textContent = errorMessage
      ? `Could not list printers: ${errorMessage}`
      : printers.length
        ? 'If your printer is missing, install it in Windows first, then press Refresh.'
        : 'No printers were reported by Windows. Enter the printer name manually below.';
  }
}

function renderConnection(info) {
  const transport = info.transport === 'ipc' ? 'Desktop app (IPC)' : 'Local HTTP helper';
  if (elements.transportLabel) elements.transportLabel.textContent = transport;

  const port = info.port;
  if (elements.portLabel) elements.portLabel.textContent = port ? String(port) : '—';
  if (elements.endpointLabel) {
    elements.endpointLabel.textContent = port
      ? `http://127.0.0.1:${port}`
      : 'Built into the desktop app';
  }

  if (elements.versionLabel) {
    const parts = [];
    if (info.status && info.status.version) parts.push(`Helper v${info.status.version}`);
    if (info.status && info.status.platform) parts.push(info.status.platform);
    elements.versionLabel.textContent = parts.join(' • ');
  }

  // The shared token only matters for the loopback HTTP transport.
  if (elements.tokenField) {
    elements.tokenField.classList.toggle('hidden', info.transport === 'ipc');
  }

  if (elements.origins) {
    elements.origins.innerHTML = '';
    const origins = Array.isArray(info.allowedOrigins) ? info.allowedOrigins : [];
    for (const origin of origins) {
      const chip = document.createElement('span');
      chip.className = 'origin';
      chip.textContent = origin;
      elements.origins.appendChild(chip);
    }
  }
}

function applyState(nextState) {
  state = nextState;
  const settings = nextState.settings || {};

  if (elements.printerName) elements.printerName.value = settings.printerName || '';
  if (elements.columns) elements.columns.value = String(settings.columns || 48);
  if (elements.token) elements.token.value = settings.token || '';

  renderPrinters(nextState.printers || [], settings.printerName || '', nextState.printerError);
  renderStatus(nextState.status || { ok: true });
  renderConnection(nextState);
}

async function loadState() {
  if (!api || typeof api.getState !== 'function') {
    showNotice('The print helper bridge is unavailable. Reinstall the application.', 'error');
    elements.statusBadge.dataset.state = 'error';
    elements.statusBadgeText.textContent = 'Bridge unavailable';
    return;
  }

  try {
    applyState(await api.getState());
  } catch (error) {
    showNotice(`Could not load settings: ${error.message}`, 'error');
  }
}

async function refreshPrinters() {
  if (!api || typeof api.listPrinters !== 'function') return;

  setBusy(true);
  try {
    const result = await api.listPrinters();
    const printers = Array.isArray(result) ? result : result && result.printers;
    const errorMessage = result && result.ok === false ? result.error : null;
    const current = (elements.printerName.value || '').trim();

    if (state) state.printers = Array.isArray(printers) ? printers : [];
    renderPrinters(state ? state.printers : [], current, errorMessage);
  } catch (error) {
    renderPrinters([], elements.printerName.value, error.message);
  } finally {
    setBusy(false);
  }
}

async function saveSettings() {
  if (!api || typeof api.saveSettings !== 'function') return;

  const printerName = (elements.printerName.value || '').trim();
  const columns = Number(elements.columns.value) || 48;
  const token = elements.token.value;

  setBusy(true);
  try {
    const result = await api.saveSettings({ printerName, columns, token });

    if (result && result.error) {
      showNotice(`Could not save settings: ${result.error}`, 'error');
      return;
    }

    if (result && result.settings) {
      state = state || {};
      state.settings = result.settings;
      state.status = result.status || state.status;
      if (elements.printerName) elements.printerName.value = result.settings.printerName || '';
      if (elements.token) elements.token.value = result.settings.token || '';
      renderStatus(state.status);
    }

    showNotice(
      printerName
        ? `Settings saved. Receipts will print to "${printerName}".`
        : 'Settings saved. Select a printer to enable direct printing.',
      'success'
    );
  } catch (error) {
    showNotice(`Could not save settings: ${error.message}`, 'error');
  } finally {
    setBusy(false);
  }
}

async function testPrint() {
  if (!api || typeof api.testPrint !== 'function') return;

  setBusy(true);
  try {
    const result = await api.testPrint();
    if (result && result.ok) {
      showNotice(result.message || 'Test receipt sent to the printer.', 'success');
      if (state) renderStatus({ ...state.status, lastError: null });
    } else {
      showNotice(
        (result && (result.error || result.message)) || 'The test print failed.',
        'error'
      );
    }
  } catch (error) {
    showNotice(`The test print failed: ${error.message}`, 'error');
  } finally {
    setBusy(false);
  }
}

function bindEvents() {
  if (elements.printerSelect) {
    elements.printerSelect.addEventListener('change', () => {
      const value = elements.printerSelect.value;
      if (value) elements.printerName.value = value;
    });
  }

  if (elements.printerName) {
    elements.printerName.addEventListener('input', () => {
      const value = elements.printerName.value;
      if (elements.printerSelect) {
        elements.printerSelect.value = Array.from(elements.printerSelect.options).some(
          (option) => option.value === value
        )
          ? value
          : '';
      }
    });
  }

  if (elements.refreshPrinters) {
    elements.refreshPrinters.addEventListener('click', refreshPrinters);
  }
  if (elements.saveSettings) {
    elements.saveSettings.addEventListener('click', saveSettings);
  }
  if (elements.testPrint) {
    elements.testPrint.addEventListener('click', testPrint);
  }
}

bindEvents();
loadState();
