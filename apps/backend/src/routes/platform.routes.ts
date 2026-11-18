import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { collectTenantExportData, PlatformService } from '../services/platform.service';
import {
  authenticatePlatform,
  authorizePlatform,
  AuthRequest,
} from '../middleware/auth';
import { PrismaClient } from '@prisma/client';
import { FEATURES, FeatureKey } from '../permissions';

const router = Router();
const platformService = new PlatformService();
const prisma = new PrismaClient();

const platformLoginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15, // Stricter limit for platform super admin / support
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many platform authentication attempts, please try again after 15 minutes.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
});

// Re-authenticating for an export is a privileged action; cap brute-force attempts.
const sensitiveExportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many export attempts, please try again after 15 minutes.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
});

function requestContext(req: AuthRequest) {
  return {
    ipAddress: req.ip,
    userAgent: Array.isArray(req.headers['user-agent'])
      ? req.headers['user-agent'][0]
      : req.headers['user-agent'],
  };
}

function safeFileNamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

async function sendZip(
  res: Response,
  entries: Array<{ name: string; content: string } | { path: string; name: string }>,
  fileName: string
): Promise<void> {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Cache-Control', 'no-store');

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (error) => res.destroy(error));
  archive.pipe(res);
  for (const entry of entries) {
    if ('content' in entry) {
      archive.append(Buffer.from(entry.content, 'utf8'), { name: entry.name });
    } else {
      archive.file(entry.path, { name: entry.name });
    }
  }
  await archive.finalize();
}

// Platform Login
router.post('/auth/login', platformLoginRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await platformService.login(email, password, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json(result);
  } catch (error: any) {
    res.status(401).json({ error: error.message || 'Invalid platform credentials' });
  }
});

// Platform Refresh Token
router.post('/auth/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Platform refresh token required' });
    }
    const result = await platformService.refresh(refreshToken);
    res.json(result);
  } catch (error: any) {
    res.status(401).json({ error: error.message || 'Invalid refresh token' });
  }
});

// Platform Logout
router.post('/auth/logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.body;
    await platformService.logout(refreshToken);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// All routes below require authenticatePlatform
router.use(authenticatePlatform);

// Current platform user profile
router.get('/me', (req: AuthRequest, res: Response) => {
  res.json({ user: req.platformUser });
});

// List all tenants (SUPER_ADMIN, SUPPORT)
router.get('/restaurants', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurants = await platformService.listRestaurants();
    res.json(restaurants);
  } catch (error) {
    next(error);
  }
});

router.get('/restaurants/:id/features', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurant = await prisma.restaurant.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
    const rows = await prisma.tenantFeature.findMany({ where: { restaurantId: req.params.id } });
    const byKey = new Map(rows.map((row) => [row.featureKey, row]));
    res.json({
      catalog: FEATURES,
      features: FEATURES.map((key) => {
        const row = byKey.get(key);
        return {
          key,
          enabled: row ? row.enabled && (!row.expiresAt || row.expiresAt > new Date()) : false,
          expiresAt: row?.expiresAt ?? null,
        };
      }),
    });
  } catch (error) {
    next(error);
  }
});

router.put('/restaurants/:id/features', authorizePlatform(['SUPER_ADMIN']), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const restaurant = await prisma.restaurant.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
    const updates = Array.isArray(req.body?.features) ? req.body.features : null;
    if (!updates) return res.status(400).json({ error: 'features must be an array' });

    const result = await prisma.$transaction(async (tx) => {
      const saved = [];
      for (const update of updates) {
        if (!FEATURES.includes(update.key as FeatureKey)) {
          throw Object.assign(new Error(`Invalid feature key: ${update.key}`), { statusCode: 400 });
        }
        const expiresAt = update.expiresAt ? new Date(update.expiresAt) : null;
        if (expiresAt && Number.isNaN(expiresAt.getTime())) {
          throw Object.assign(new Error('Invalid expiresAt'), { statusCode: 400 });
        }
        const row = await tx.tenantFeature.upsert({
          where: { restaurantId_featureKey: { restaurantId: req.params.id, featureKey: update.key } },
          create: {
            restaurantId: req.params.id,
            featureKey: update.key,
            enabled: Boolean(update.enabled),
            expiresAt,
            grantedByPlatformUserId: req.platformUser?.id,
          },
          update: { enabled: Boolean(update.enabled), expiresAt, grantedByPlatformUserId: req.platformUser?.id },
        });
        await tx.platformAuditLog.create({
          data: {
            platformUserId: req.platformUser!.id,
            restaurantId: req.params.id,
            action: 'TENANT_FEATURE_UPDATED',
            details: JSON.stringify({ feature: update.key, enabled: Boolean(update.enabled), expiresAt }),
          },
        });
        saved.push(row);
      }
      return saved;
    });
    res.json({ features: result });
  } catch (error: any) {
    if (error?.statusCode === 400) return res.status(400).json({ error: error.message });
    next(error);
  }
});

// Create tenant and business owner atomically (SUPER_ADMIN only)
router.post(
  '/restaurants',
  authorizePlatform(['SUPER_ADMIN']),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const {
        businessName,
        address,
        phone,
        businessEmail,
        timezone,
        logoUrl,
        ownerFirstName,
        ownerLastName,
        ownerEmail,
        ownerPhone,
        ownerPassword,
        ownerPin,
        features,
        featureExpiresAt,
      } = req.body;

      if (
        !businessName ||
        !address ||
        !address.trim() ||
        !(phone?.trim() || ownerPhone?.trim()) ||
        !ownerFirstName ||
        !ownerLastName ||
        !ownerEmail ||
        !ownerPassword
      ) {
        return res.status(400).json({
          error:
            'Missing required fields: businessName, address, phone, ownerFirstName, ownerLastName, ownerEmail, ownerPassword',
        });
      }

      if (ownerPassword.length < 6) {
        return res.status(400).json({
          error: 'Owner password must be at least 6 characters long',
        });
      }

      if (ownerPin !== undefined && ownerPin !== null && String(ownerPin).trim() !== '') {
        if (!/^\d{6}$/.test(String(ownerPin).trim())) {
          return res.status(400).json({ error: 'Owner PIN must be exactly 6 digits' });
        }
      }

      const result = await platformService.createRestaurant(
        {
          businessName,
          address,
          phone,
          businessEmail,
          timezone,
          logoUrl,
          ownerFirstName,
          ownerLastName,
          ownerEmail,
          ownerPhone,
          ownerPassword,
          ownerPin,
          features,
          featureExpiresAt,
        },
        req.platformUser!.id,
        {
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        }
      );

      res.status(201).json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Failed to create business' });
    }
  }
);

// Update tenant business details or status (SUPER_ADMIN only)
router.patch(
  '/restaurants/:id',
  authorizePlatform(['SUPER_ADMIN']),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const updated = await platformService.updateRestaurant(
        req.params.id,
        req.body,
        req.platformUser!.id,
        {
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        }
      );
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Failed to update business' });
    }
  }
);

// Reset business owner password (SUPER_ADMIN only)
router.post(
  '/restaurants/:id/reset-owner-password',
  authorizePlatform(['SUPER_ADMIN']),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { newPassword } = req.body;
      const result = await platformService.resetOwnerPassword(
        req.params.id,
        newPassword,
        req.platformUser!.id,
        {
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        }
      );
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Failed to reset owner password' });
    }
  }
);

// Impersonate / Enter tenant in support mode (SUPER_ADMIN, SUPPORT)
router.post(
  '/restaurants/:id/enter',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { reason } = req.body || {};
      const session = await platformService.enterTenant(
        req.params.id,
        req.platformUser!,
        reason,
        {
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        }
      );
      res.json(session);
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Failed to enter tenant' });
    }
  }
);

// Manage single SUPPORT user account (SUPER_ADMIN only)
const handleUpsertSupportAccount = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, email, password, isActive } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Support email is required' });
    }

    const supportAccount = await platformService.upsertSupportAccount(
      { name, email, password, isActive },
      req.platformUser!.id,
      {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      }
    );

    res.json(supportAccount);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to configure support account' });
  }
};

router.put('/support-account', authorizePlatform(['SUPER_ADMIN']), handleUpsertSupportAccount);
router.post('/support-account', authorizePlatform(['SUPER_ADMIN']), handleUpsertSupportAccount);

// Platform Audit Logs (SUPER_ADMIN only)
router.get(
  '/audit-logs',
  authorizePlatform(['SUPER_ADMIN']),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = parseInt(req.query.limit as string, 10) || 50;
      const restaurantId = req.query.restaurantId as string;
      const action = req.query.action as string;

      const logs = await platformService.getAuditLogs({ page, limit, restaurantId, action });
      res.json(logs);
    } catch (error) {
      next(error);
    }
  }
);

// Platform SUPER_ADMIN tenant export: a ZIP of CSVs containing one business's
// data. Requires password re-entry and writes an audit record before any bytes
// are streamed. Platform tables and credential fields are never included.
router.post(
  '/restaurants/:id/export',
  sensitiveExportLimiter,
  authorizePlatform(['SUPER_ADMIN']),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const restaurantId = req.params.id;
      const password = req.body?.password;
      if (typeof password !== 'string' || !password) {
        return res.status(400).json({ error: 'Password re-entry is required to export business data.' });
      }

      const restaurant = await prisma.restaurant.findUnique({
        where: { id: restaurantId },
        select: { id: true, name: true },
      });
      if (!restaurant) {
        return res.status(404).json({ error: 'Business not found.' });
      }

      const platformUserId = req.platformUser!.id;
      const context = requestContext(req);
      const passwordValid = await platformService.verifyPlatformPassword(platformUserId, password);
      if (!passwordValid) {
        await platformService.recordSensitiveAudit({
          platformUserId,
          restaurantId,
          action: 'TENANT_DATA_EXPORT_DENIED',
          details: 'Password re-entry failed',
          ...context,
        });
        return res.status(401).json({ error: 'Incorrect password. Export was denied and logged.' });
      }

      const { files, counts, totalRows } = await collectTenantExportData(restaurantId);
      await platformService.recordSensitiveAudit({
        platformUserId,
        restaurantId,
        action: 'TENANT_DATA_EXPORTED',
        details: JSON.stringify({
          tableCounts: counts,
          totalRows,
          excludedTables: ['PlatformUser', 'PlatformRefreshToken', 'PlatformAuditLog', 'RefreshToken'],
          excludedFields: ['pin', 'passwordHash', 'token'],
        }),
        ...context,
      });

      const date = new Date().toISOString().slice(0, 10);
      const label = safeFileNamePart(restaurant.name || restaurantId);
      await sendZip(res, files, `${label}-data-${date}.zip`);
    } catch (error) {
      next(error);
    }
  }
);

// Whole-database backup download is privileged: it requires password re-entry
// and an audit record. Only dated PostgreSQL dumps from BACKUP_DIR are zipped —
// never env files or secrets.
router.post(
  '/backups/export',
  sensitiveExportLimiter,
  authorizePlatform(['SUPER_ADMIN']),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const password = req.body?.password;
      if (typeof password !== 'string' || !password) {
        return res.status(400).json({ error: 'Password re-entry is required to download database backups.' });
      }

      const platformUserId = req.platformUser!.id;
      const context = requestContext(req);
      const passwordValid = await platformService.verifyPlatformPassword(platformUserId, password);
      if (!passwordValid) {
        await platformService.recordSensitiveAudit({
          platformUserId,
          action: 'BACKUP_ZIP_EXPORT_DENIED',
          details: 'Password re-entry failed',
          ...context,
        });
        return res.status(401).json({ error: 'Incorrect password. Download was denied and logged.' });
      }

      const backupDir = path.resolve(process.env.BACKUP_DIR || '/var/backups/restaurant-pos');
      const prefix = process.env.BACKUP_PREFIX || 'restaurant-pos';
      if (!fs.existsSync(backupDir)) {
        return res.status(404).json({ error: 'No backups directory is configured on the server.' });
      }

      const fileNames = fs
        .readdirSync(backupDir)
        .filter((name) => name.startsWith(`${prefix}-`) && name.endsWith('.sql.gz'))
        .filter((name) => fs.statSync(path.join(backupDir, name)).isFile())
        .sort()
        .reverse();

      if (fileNames.length === 0) {
        return res.status(404).json({ error: 'No backups are available yet.' });
      }

      await platformService.recordSensitiveAudit({
        platformUserId,
        action: 'BACKUP_ZIP_EXPORTED',
        details: JSON.stringify({
          backupFileCount: fileNames.length,
          newestBackup: fileNames[0],
          oldestBackup: fileNames[fileNames.length - 1],
        }),
        ...context,
      });

      const date = new Date().toISOString().slice(0, 10);
      await sendZip(
        res,
        fileNames.map((name) => ({ name, path: path.join(backupDir, name) })),
        `${prefix}-backups-${date}.zip`
      );
    } catch (error) {
      next(error);
    }
  }
);

export default router;
