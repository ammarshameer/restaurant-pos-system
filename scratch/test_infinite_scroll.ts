import { OrderService } from '../apps/backend/src/services/order.service';
import { PaymentService } from '../apps/backend/src/services/payment.service';
import { InventoryService } from '../apps/backend/src/services/inventory.service';
import { MenuService } from '../apps/backend/src/services/menu.service';
import { EmployeeService } from '../apps/backend/src/services/employee.service';
import { AnalyticsService } from '../apps/backend/src/services/analytics.service';
import { prisma } from '../apps/backend/src/index';

const orderService = new OrderService();
const paymentService = new PaymentService();
const inventoryService = new InventoryService();
const menuService = new MenuService();
const employeeService = new EmployeeService();
const analyticsService = new AnalyticsService();

async function runTests() {
  console.log('🧪 Starting Infinite Scroll Pagination Validation Tests...\n');

  try {
    // 1. Orders pagination
    console.log('1. Testing Orders Pagination (GET /api/orders)...');
    const ordersResult = await orderService.getAllOrdersByRestaurant('rest-default-1', {
      page: 1,
      limit: 50,
    });
    console.log(`   ✓ Returned page: ${ordersResult.page}, limit: ${ordersResult.limit}, totalCount: ${ordersResult.totalCount}, hasMore: ${ordersResult.hasMore}, records: ${ordersResult.data.length}`);
    if (typeof ordersResult.page !== 'number' || typeof ordersResult.totalCount !== 'number' || typeof ordersResult.hasMore !== 'boolean') {
      throw new Error('Orders response format invalid');
    }

    // 2. Payments pagination
    console.log('\n2. Testing Payments Pagination (GET /api/payments)...');
    const paymentsResult = await paymentService.getPaymentsByRestaurant('rest-default-1', {
      page: 1,
      limit: 50,
    });
    console.log(`   ✓ Returned page: ${paymentsResult.page}, limit: ${paymentsResult.limit}, totalCount: ${paymentsResult.totalCount}, hasMore: ${paymentsResult.hasMore}, records: ${paymentsResult.data.length}`);
    if (typeof paymentsResult.page !== 'number' || typeof paymentsResult.totalCount !== 'number' || typeof paymentsResult.hasMore !== 'boolean') {
      throw new Error('Payments response format invalid');
    }

    // 3. Inventory items pagination
    console.log('\n3. Testing Inventory Items Pagination (GET /api/inventory)...');
    const inventoryResult = await inventoryService.getInventoryItems('rest-default-1', {
      page: 1,
      limit: 50,
    });
    console.log(`   ✓ Returned page: ${inventoryResult.page}, limit: ${inventoryResult.limit}, totalCount: ${inventoryResult.totalCount}, hasMore: ${inventoryResult.hasMore}, records: ${inventoryResult.data.length}`);
    if (typeof inventoryResult.page !== 'number' || typeof inventoryResult.totalCount !== 'number' || typeof inventoryResult.hasMore !== 'boolean') {
      throw new Error('Inventory items response format invalid');
    }

    // 4. Inventory transactions pagination
    console.log('\n4. Testing Inventory Transactions Pagination (GET /api/inventory/transactions/all)...');
    const txResult = await inventoryService.getInventoryTransactions(undefined, {
      page: 1,
      limit: 50,
    });
    console.log(`   ✓ Returned page: ${txResult.page}, limit: ${txResult.limit}, totalCount: ${txResult.totalCount}, hasMore: ${txResult.hasMore}, records: ${txResult.data.length}`);
    if (typeof txResult.page !== 'number' || typeof txResult.totalCount !== 'number' || typeof txResult.hasMore !== 'boolean') {
      throw new Error('Inventory transactions response format invalid');
    }

    // 5. Menu items pagination
    console.log('\n5. Testing Menu Items Pagination (GET /api/menu/items)...');
    const menuResult = await menuService.getMenuItems('rest-default-1', {
      page: 1,
      limit: 50,
    });
    console.log(`   ✓ Returned page: ${menuResult.page}, limit: ${menuResult.limit}, totalCount: ${menuResult.totalCount}, hasMore: ${menuResult.hasMore}, records: ${menuResult.data.length}`);
    if (typeof menuResult.page !== 'number' || typeof menuResult.totalCount !== 'number' || typeof menuResult.hasMore !== 'boolean') {
      throw new Error('Menu items response format invalid');
    }

    // 6. Employees pagination
    console.log('\n6. Testing Employees Pagination (GET /api/employees)...');
    const employeesResult = await employeeService.getEmployees('rest-default-1', {
      page: 1,
      limit: 50,
    });
    console.log(`   ✓ Returned page: ${employeesResult.page}, limit: ${employeesResult.limit}, totalCount: ${employeesResult.totalCount}, hasMore: ${employeesResult.hasMore}, records: ${employeesResult.data.length}`);
    if (typeof employeesResult.page !== 'number' || typeof employeesResult.totalCount !== 'number' || typeof employeesResult.hasMore !== 'boolean') {
      throw new Error('Employees response format invalid');
    }

    // 7. Analytics Top Items pagination
    console.log('\n7. Testing Top Selling Items Pagination (GET /api/analytics/top-items/:restaurantId)...');
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const topItemsResult = await analyticsService.getTopSellingItems('rest-default-1', {
      startDate: startOfMonth,
      endDate: now,
      page: 1,
      limit: 50,
    });
    console.log(`   ✓ Returned page: ${topItemsResult.page}, limit: ${topItemsResult.limit}, totalCount: ${topItemsResult.totalCount}, hasMore: ${topItemsResult.hasMore}, records: ${topItemsResult.data.length}`);
    if (typeof topItemsResult.page !== 'number' || typeof topItemsResult.totalCount !== 'number' || typeof topItemsResult.hasMore !== 'boolean') {
      throw new Error('Top selling items response format invalid');
    }

    console.log('\n🎉 ALL 7 BACKEND PAGINATED SERVICES PASSED VALIDATION PERFECTLY!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

runTests();
