import fs from 'fs';
import path from 'path';

export class BackupService {
  private dbPath: string | null = null;
  private backupsDir: string | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    this.resolvePaths();
  }

  public resolvePaths() {
    const rawDbUrl = process.env.DATABASE_URL || 'file:./prisma/dev.db';
    let cleanPath = rawDbUrl.replace(/^file:/, '').split('?')[0];

    if (!path.isAbsolute(cleanPath)) {
      cleanPath = path.resolve(process.cwd(), cleanPath);
    }

    this.dbPath = cleanPath;

    if (process.platform === 'win32' && process.env.APPDATA) {
      this.backupsDir = path.join(process.env.APPDATA, 'restaurant-pos', 'backups');
    } else {
      const parentDir = path.dirname(this.dbPath);
      this.backupsDir = path.join(parentDir, '..', 'backups');
    }

    try {
      if (!fs.existsSync(this.backupsDir)) {
        fs.mkdirSync(this.backupsDir, { recursive: true });
      }
    } catch (err) {
      // Ignore if directory creation will happen during backup
    }
  }

  getLocalDateString(date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  enforceRetention(maxCount = 30) {
    if (!this.backupsDir || !fs.existsSync(this.backupsDir)) return;

    try {
      const files = fs.readdirSync(this.backupsDir);
      const backupFiles = files
        .filter((file) => file.startsWith('backup-') && file.endsWith('.db'))
        .map((file) => ({
          filename: file,
          filePath: path.join(this.backupsDir!, file),
        }));

      backupFiles.sort((a, b) => a.filename.localeCompare(b.filename));

      if (backupFiles.length > maxCount) {
        const toDelete = backupFiles.slice(0, backupFiles.length - maxCount);
        for (const f of toDelete) {
          try {
            fs.unlinkSync(f.filePath);
            console.log(`[Backup] Pruned old backup: ${f.filename} (rolling 30-day retention)`);
          } catch (e: any) {
            console.error(`[Backup] Failed to prune ${f.filename}:`, e.message);
          }
        }
      }
    } catch (err: any) {
      console.error(`[Backup Error] Error enforcing retention:`, err.message);
    }
  }

  performBackup(triggerReason = 'startup'): boolean {
    if (!this.dbPath || !fs.existsSync(this.dbPath)) {
      console.warn(`[Backup] Source SQLite database file not found at: ${this.dbPath}`);
      return false;
    }

    try {
      if (!this.backupsDir) this.resolvePaths();
      if (!fs.existsSync(this.backupsDir!)) {
        fs.mkdirSync(this.backupsDir!, { recursive: true });
      }

      const dateStr = this.getLocalDateString();
      const backupFileName = `backup-${dateStr}.db`;
      const targetBackupPath = path.join(this.backupsDir!, backupFileName);

      fs.copyFileSync(this.dbPath, targetBackupPath);

      const stats = fs.statSync(targetBackupPath);
      console.log(
        `[Backup] ✓ SQLite database successfully backed up to "${targetBackupPath}" (${(stats.size / 1024).toFixed(1)} KB) [Trigger: ${triggerReason}]`
      );

      // Handle WAL mode copy if exists
      const walSource = `${this.dbPath}-wal`;
      const walTarget = `${targetBackupPath}-wal`;
      if (fs.existsSync(walSource)) {
        try {
          fs.copyFileSync(walSource, walTarget);
        } catch {
          // Ignore transient WAL copy errors
        }
      }

      this.enforceRetention(30);
      return true;
    } catch (err: any) {
      console.error(`[Backup Error] ✗ Failed to backup database to "${this.backupsDir}":`, err.message);
      return false;
    }
  }

  startDailyTimer() {
    let lastBackupDate = this.getLocalDateString();
    this.timer = setInterval(() => {
      const today = this.getLocalDateString();
      if (today !== lastBackupDate) {
        console.log(`[Backup] New day detected (${today}). Running daily automated backup...`);
        const success = this.performBackup('daily timer');
        if (success) {
          lastBackupDate = today;
        }
      }
    }, 60 * 60 * 1000); // Check hourly
  }

  getBackupsList() {
    if (!this.backupsDir || !fs.existsSync(this.backupsDir)) return [];
    try {
      const files = fs.readdirSync(this.backupsDir);
      return files
        .filter((file) => file.startsWith('backup-') && file.endsWith('.db'))
        .map((file) => {
          const filePath = path.join(this.backupsDir!, file);
          const stats = fs.statSync(filePath);
          return {
            filename: file,
            sizeBytes: stats.size,
            sizeKb: (stats.size / 1024).toFixed(1),
            createdAt: stats.mtime,
          };
        })
        .sort((a, b) => b.filename.localeCompare(a.filename));
    } catch {
      return [];
    }
  }
}

export const backupService = new BackupService();
