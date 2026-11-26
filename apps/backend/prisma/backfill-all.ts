import 'dotenv/config';
import {
  backfillTenantFeatures,
  disconnectTenantFeaturesDb,
} from './backfill-tenant-features';
import { backfillMultiTenant, disconnectMultiTenantDb } from './backfill-multi-tenant';
import { backfillAmountDue, disconnectAmountDueDb } from './backfill-amount-due';
import {
  backfillOwnerAddress,
  disconnectOwnerAddressDb,
} from './backfill-owner-address';
import {
  backfillOwnerLogo,
  disconnectOwnerLogoDb,
} from './backfill-owner-logo';
import {
  backfillOrderDiscount,
  disconnectOrderDiscountDb,
} from './backfill-order-discount';
import {
  repairOrderDiscountPayments,
  disconnectOrderDiscountRepairDb,
} from './repair-order-discount-payment';
import {
  verifyBackfilledTenants,
  disconnectBackfillVerifyDb,
} from '../scripts/verify-backfill';

/**
 * Single mandatory post-delta upgrade command. Every step is idempotent and
 * safe to re-run; the final verification is fail-closed.
 */
export async function runFullBackfill() {
  console.log('=== Restoring legacy tenant modules ===');
  const features = await backfillTenantFeatures();

  console.log('\n=== Running multi-tenant backfill ===');
  await backfillMultiTenant();

  console.log('\n=== Repairing unpaid order balances ===');
  const ordersUpdated = await backfillAmountDue();

  console.log('\n=== Restoring Owner Profile addresses ===');
  const ownerAddressesUpdated = await backfillOwnerAddress();

  console.log('\n=== Restoring Owner Profile logos ===');
  const ownerLogosUpdated = await backfillOwnerLogo();

  console.log('\n=== Restoring order discounts ===');
  const orderDiscountsUpdated = await backfillOrderDiscount();

  console.log('\n=== Repairing discounted payments billed as balance due ===');
  const discountPaymentsRepaired = await repairOrderDiscountPayments();

  const report = await verifyBackfilledTenants();

  console.log('=============================================');
  console.log('Full backfill complete');
  console.log('=============================================');
  console.log(`- Businesses processed:              ${features.restaurantsProcessed}`);
  console.log(`- Legacy module rows created:        ${features.featuresCreated}`);
  console.log(`- Costing rows created (disabled):   ${features.costingRowsCreated}`);
  console.log(`- Order balances repaired:           ${ordersUpdated}`);
  console.log(`- Owner addresses restored:          ${ownerAddressesUpdated}`);
  console.log(`- Owner logos restored:              ${ownerLogosUpdated}`);
  console.log(`- Order discounts derived:           ${orderDiscountsUpdated}`);
  console.log(`- Discounted payments repaired:      ${discountPaymentsRepaired}`);
  console.log(`- Verification failures:             ${report.failures.length}`);
  console.log('=============================================\n');

  if (report.failures.length > 0) {
    throw new Error(`Post-backfill verification failed for ${report.failures.length} check(s).`);
  }
}

async function run() {
  try {
    await runFullBackfill();
  } catch (error) {
    console.error('Full backfill failed:', error);
    process.exitCode = 1;
  } finally {
    await disconnectFullBackfillClients();
  }
}

export async function disconnectFullBackfillClients(): Promise<void> {
  await Promise.all([
    disconnectTenantFeaturesDb(),
    disconnectMultiTenantDb(),
    disconnectAmountDueDb(),
    disconnectOwnerAddressDb(),
    disconnectOwnerLogoDb(),
    disconnectOrderDiscountDb(),
    disconnectOrderDiscountRepairDb(),
    disconnectBackfillVerifyDb(),
  ]);
}

if (require.main === module || (process.argv[1] && process.argv[1].includes('backfill-all'))) {
  void run();
}
