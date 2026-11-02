'use strict';

const fs = require('fs');
const path = require('path');
const { DEFAULT_TOKEN, DEFAULT_COLUMNS } = require('./constants');

const SETTINGS_FILENAME = 'print-helper-settings.json';

function defaultSettings() {
  return {
    printerName: '',
    token: DEFAULT_TOKEN,
    columns: DEFAULT_COLUMNS,
  };
}

function getSettingsPath(userDataPath) {
  return path.join(userDataPath, SETTINGS_FILENAME);
}

function normalizeSettings(input = {}, base = defaultSettings()) {
  const printerName =
    typeof input.printerName === 'string' ? input.printerName.trim() : base.printerName;

  const token =
    typeof input.token === 'string' && input.token.trim()
      ? input.token.trim()
      : base.token;

  const parsedColumns = Number(input.columns);
  const columns =
    Number.isFinite(parsedColumns) && parsedColumns >= 24
      ? Math.min(80, Math.trunc(parsedColumns))
      : base.columns;

  return { printerName, token, columns };
}

function loadSettings(userDataPath) {
  const filePath = getSettingsPath(userDataPath);
  try {
    if (!fs.existsSync(filePath)) return defaultSettings();
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return normalizeSettings(parsed);
  } catch (error) {
    console.warn(`[Print Helper] Could not read settings at ${filePath}:`, error.message);
    return defaultSettings();
  }
}

function saveSettings(userDataPath, nextSettings) {
  const current = loadSettings(userDataPath);
  const normalized = normalizeSettings(nextSettings, current);
  const filePath = getSettingsPath(userDataPath);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(normalized, null, 2), { mode: 0o600 });
  fs.renameSync(tempPath, filePath);

  return normalized;
}

module.exports = {
  SETTINGS_FILENAME,
  defaultSettings,
  getSettingsPath,
  normalizeSettings,
  loadSettings,
  saveSettings,
};
