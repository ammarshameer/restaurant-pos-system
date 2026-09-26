const fs = require('fs');
const path = require('path');
const {
  performDatabaseBackup,
  enforceBackupRetention,
  getLocalDateString,
} = require('../electron/backup');

async function testDatabaseBackups() {
  console.log('🧪 Testing Automated Database Backups & 30-Day Retention Policy...\n');

  const testTempDir = path.join(__dirname, 'test_backup_sandbox');
  const testDbDir = path.join(testTempDir, 'database');
  const testBackupsDir = path.join(testTempDir, 'backups');

  // Clean up sandbox
  if (fs.existsSync(testTempDir)) {
    fs.rmSync(testTempDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDbDir, { recursive: true });
  fs.mkdirSync(testBackupsDir, { recursive: true });

  // 1. Create a dummy sqlite database file
  const sourceDbPath = path.join(testDbDir, 'dev.db');
  fs.writeFileSync(sourceDbPath, 'SQLite format 3\0 - Mock test POS DB data for backup verification');

  console.log('1️⃣ Testing App Startup Backup...');
  const startupResult = performDatabaseBackup(sourceDbPath, testBackupsDir, 'startup');
  if (!startupResult) throw new Error('Startup backup failed');

  const todayStr = getLocalDateString(new Date());
  const expectedBackupFile = path.join(testBackupsDir, `backup-${todayStr}.db`);
  if (!fs.existsSync(expectedBackupFile)) {
    throw new Error(`Expected backup file not found: ${expectedBackupFile}`);
  }
  console.log(`✓ Verified startup backup exists: ${path.basename(expectedBackupFile)}\n`);

  // 2. Test Clean Shutdown Backup
  console.log('2️⃣ Testing App Clean Shutdown Backup...');
  // Modify DB content to simulate end-of-day changes
  fs.writeFileSync(sourceDbPath, 'SQLite format 3\0 - Updated transactions at end of day');
  const shutdownResult = performDatabaseBackup(sourceDbPath, testBackupsDir, 'clean shutdown');
  if (!shutdownResult) throw new Error('Shutdown backup failed');

  const backupContent = fs.readFileSync(expectedBackupFile, 'utf8');
  if (!backupContent.includes('Updated transactions at end of day')) {
    throw new Error('Shutdown backup did not capture updated database contents');
  }
  console.log('✓ Clean shutdown backup updated database file with latest state\n');

  // 3. Test Rolling 30-Day Retention Policy
  console.log('3️⃣ Testing 30-Day Rolling Retention Policy...');
  // Create 35 simulated daily backup files from backup-2026-08-01.db to backup-2026-09-04.db
  for (let i = 1; i <= 35; i++) {
    const day = String(i).padStart(2, '0');
    const dummyFile = path.join(testBackupsDir, `backup-2026-08-${day}.db`);
    fs.writeFileSync(dummyFile, `Mock backup for day ${i}`);
  }

  const beforeCount = fs.readdirSync(testBackupsDir).filter(f => f.endsWith('.db')).length;
  console.log(`Total backups before retention cleanup: ${beforeCount} (including today)`);

  enforceBackupRetention(testBackupsDir, 30);

  const afterFiles = fs.readdirSync(testBackupsDir).filter(f => f.endsWith('.db'));
  console.log(`Total backups after retention cleanup: ${afterFiles.length}`);

  if (afterFiles.length !== 30) {
    throw new Error(`Expected 30 backups retained, but found ${afterFiles.length}`);
  }

  // Ensure the oldest 6 files (backup-2026-08-01 to 06) were pruned
  if (fs.existsSync(path.join(testBackupsDir, 'backup-2026-08-01.db'))) {
    throw new Error('Oldest backup backup-2026-08-01.db was not pruned!');
  }
  if (!fs.existsSync(expectedBackupFile)) {
    throw new Error('Today\'s latest backup was incorrectly pruned!');
  }
  console.log('✓ Verified oldest backups were pruned and exactly 30 latest backups are retained!\n');

  // 4. Test Error Logging on missing DB
  console.log('4️⃣ Testing Failure Handling on Missing DB...');
  const failResult = performDatabaseBackup('/non/existent/path/db.sqlite', testBackupsDir, 'test');
  if (failResult !== false) {
    throw new Error('Expected backup to return false on non-existent file');
  }
  console.log('✓ Missing file handled gracefully without crashing\n');

  // Clean up sandbox
  fs.rmSync(testTempDir, { recursive: true, force: true });
  console.log('🎉 ALL DATABASE BACKUP & RETENTION TESTS PASSED 100%!');
}

testDatabaseBackups()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Backup test failed:', err);
    process.exit(1);
  });
