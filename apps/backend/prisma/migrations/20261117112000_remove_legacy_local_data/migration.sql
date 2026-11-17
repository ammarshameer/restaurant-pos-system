-- The retired local data-management module left permission and feature rows in
-- existing databases. Remove them so roles/custom UI no longer reference a
-- capability the online-only build does not provide. LIKE patterns keep this
-- compatible with databases that still use the old string identifiers.
DELETE FROM "RolePermission" WHERE "permission" LIKE 'backups.%';
DELETE FROM "EmployeePermission" WHERE "permission" LIKE 'backups.%';
DELETE FROM "TenantFeature" WHERE "featureKey" LIKE 'backups%';
