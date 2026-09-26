import { Router } from 'express';
import { backupService } from '../services/backup.service';

const router = Router();

// List all automated and manual database backups
router.get('/', (req, res) => {
  try {
    const backups = backupService.getBackupsList();
    res.json({
      backups,
      count: backups.length,
      retentionPolicy: 'Rolling 30-day retention',
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Trigger a database backup manually
router.post('/trigger', (req, res) => {
  try {
    const success = backupService.performBackup('manual trigger');
    if (success) {
      res.json({ message: 'Backup created successfully', success: true });
    } else {
      res.status(500).json({ message: 'Failed to create backup', success: false });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
