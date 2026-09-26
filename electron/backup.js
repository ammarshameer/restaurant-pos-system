const fs = require('fs');
const path = require('path');

/**
 * Formats a Date object into YYYY-MM-DD local date string.
 * @param {Date} date
 * @returns {string} e.g. "2026-09-26"
 */
function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Resolves the backups directory path.
 * In Electron, typically: %APPDATA%\restaurant-pos\backups or userData/backups
 * @param {string} baseUserDataPath
 * @returns {string}
 */
function getBackupsDirectory(baseUserDataPath) {
  const backupsDir = path.join(baseUserDataPath, 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }
  return backupsDir;
}

/**
 * Enforces a rolling 30-day retention policy on the backups directory.
 * Keeps at least the last 30 daily backups, deleting older ones automatically.
 * @param {string} backupsDir
 * @param {number} maxBackups - Default 30
 */
function enforceBackupRetention(backupsDir, maxBackups = 30) {
  try {
    if (!fs.existsSync(backupsDir)) return;

    const files = fs.readdirSync(backupsDir);
    // Match backup files like "backup-2026-09-26.db" or "backup-*.db"
    const backupFiles = files
      .filter((file) => file.startsWith('backup-') && file.endsWith('.db'))
      .map((file) => {
        const filePath = path.join(backupsDir, file);
        const stats = fs.statSync(filePath);
        return {
          filename: file,
          filePath,
          mtime: stats.mtime.getTime(),
        };
      });

    // Sort ascending by filename/mtime (oldest first)
    backupFiles.sort((a, b) => a.filename.localeCompare(b.filename));

    if (backupFiles.length > maxBackups) {
      const deleteCount = backupFiles.length - maxBackups;
      const filesToDelete = backupFiles.slice(0, deleteCount);

      for (const item of filesToDelete) {
        try {
          fs.unlinkSync(item.filePath);
          console.log(`[Backup] Pruned old backup file (30-day rolling retention): ${item.filename}`);
        } catch (err) {
          console.error(`[Backup] Failed to delete old backup file ${item.filename}:`, err.message);
        }
      }

      console.log(`[Backup] Retention cleanup complete: Pruned ${deleteCount} old backup(s), retained latest ${maxBackups}.`);
    }
  } catch (err) {
    console.error('[Backup Error] Error during backup retention enforcement:', err);
  }
}

/**
 * Performs SQLite database backup by copying the live SQLite database file to a dated backup file.
 * e.g. %APPDATA%\restaurant-pos\backups\backup-2026-09-26.db
 *
 * @param {string} dbFilePath - Absolute path to the live SQLite database file
 * @param {string} backupsDir - Directory to store backup files
 * @param {string} triggerReason - "startup" | "timer" | "clean shutdown" | "manual"
 * @returns {boolean} True if backup succeeded, false otherwise
 */
function performDatabaseBackup(dbFilePath, backupsDir, triggerReason = 'startup') {
  const timestamp = new Date().toISOString();
  console.log(`[Backup] [${timestamp}] Starting database backup (Trigger: ${triggerReason})...`);

  try {
    if (!dbFilePath || !fs.existsSync(dbFilePath)) {
      console.error(`[Backup Error] Source database file not found at: ${dbFilePath}`);
      return false;
    }

    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }

    const dateStr = getLocalDateString(new Date());
    const backupFileName = `backup-${dateStr}.db`;
    const targetBackupPath = path.join(backupsDir, backupFileName);

    // Copy live database file to backup target
    fs.copyFileSync(dbFilePath, targetBackupPath);

    const stats = fs.statSync(targetBackupPath);
    const sizeKb = (stats.size / 1024).toFixed(1);

    console.log(`[Backup] ✓ SUCCESS: Live database backed up to "${targetBackupPath}" (${sizeKb} KB) [Trigger: ${triggerReason}]`);

    // Also copy WAL file if present for transactional completeness
    const walSource = `${dbFilePath}-wal`;
    const walTarget = `${targetBackupPath}-wal`;
    if (fs.existsSync(walSource)) {
      try {
        fs.copyFileSync(walSource, walTarget);
      } catch (walErr) {
        // WAL file may be empty or transient
      }
    }

    // Apply rolling 30-day retention
    enforceBackupRetention(backupsDir, 30);

    return true;
  } catch (err) {
    console.error(`[Backup Error] ✗ FAILED to backup database to "${backupsDir}":`, err.message);
    return false;
  }
}

/**
 * Starts a timer that performs a daily backup once every 24 hours while the app remains running.
 * @param {string} dbFilePath
 * @param {string} backupsDir
 * @returns {NodeJS.Timeout}
 */
function startDailyBackupTimer(dbFilePath, backupsDir) {
  // Check every hour if a new calendar day has started
  let lastBackupDate = getLocalDateString(new Date());

  const interval = setInterval(() => {
    const currentDate = getLocalDateString(new Date());
    if (currentDate !== lastBackupDate) {
      console.log(`[Backup] New day detected (${currentDate}). Running daily automated backup...`);
      const success = performDatabaseBackup(dbFilePath, backupsDir, 'daily timer');
      if (success) {
        lastBackupDate = currentDate;
      }
    }
  }, 60 * 60 * 1000); // Check hourly

  return interval;
}

module.exports = {
  getLocalDateString,
  getBackupsDirectory,
  enforceBackupRetention,
  performDatabaseBackup,
  startDailyBackupTimer,
};
