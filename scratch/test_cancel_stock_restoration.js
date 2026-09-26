const path = require('path');
const { PrismaClient } = require(path.join(__dirname, '../apps/backend/node_modules/@prisma/client'));
const prisma = new PrismaClient();

const { OrderService } = require('../apps/backend/dist/services/order.service');
const { InventoryService } = require('../apps/backend/dist/services/inventory.service');

async function testCancellationInventoryRestoration() {
  console.log('🧪 Testing Inventory Restoration on Order Cancellation & Double-Restock Prevention...');

  const restaurantId = 'rest-default-1';
  const orderService = new OrderService();
  const inventoryService = new InventoryService();

  // 1. Clean up & Create test inventory item
  await prisma.inventoryTransaction.deleteMany({
    where: { inventoryItem: { name: 'test cancellation patty' } }
  });
  await prisma.inventoryItem.deleteMany({
    where: { name: 'test cancellation patty' }
  });

  const testPatty = await inventoryService.createInventoryItem({
    name: 'test cancellation patty',
    unit: 'pcs',
    quantity: 10,
    reorderPoint: 3,
    costPerUnit: 150,
    restaurantId,
    category: 'Meat'
  });

  console.log(`✓ Created Inventory Item: "${testPatty.name}" with Initial Stock = ${testPatty.quantity}`);

  // 2. Create or verify Menu Item "Test Double Burger"
  let cat = await prisma.category.findFirst({ where: { restaurantId } });
  if (!cat) {
    cat = await prisma.category.create({ data: { name: 'Burgers', restaurantId } });
  }

  let burger = await prisma.menuItem.findFirst({
    where: { name: 'Test Double Burger' }
  });

  if (!burger) {
    burger = await prisma.menuItem.create({
      data: {
        name: 'Test Double Burger',
        price: 600,
        categoryId: cat.id,
        restaurantId,
      }
    });
  }

  await prisma.menuItemIngredient.deleteMany({
    where: { menuItemId: burger.id }
  });
  await prisma.menuItemIngredient.create({
    data: {
      menuItemId: burger.id,
      inventoryItemId: testPatty.id,
      quantityUsed: 2, // 2 patties per burger
    }
  });

  console.log(`✓ Menu Item: "${burger.name}" (uses 2x "${testPatty.name}")`);

  // 3. Place order for 2x Burgers (should deduct 4 patties: 10 -> 6)
  console.log('🛒 Step 1: Placing order for 2x Test Double Burger...');
  const order = await orderService.createOrder({
    orderNumber: 88888,
    orderType: 'DINE_IN',
    restaurantId,
    items: [
      {
        menuItemId: burger.id,
        name: burger.name,
        quantity: 2,
        price: 600,
      }
    ]
  });

  const afterOrderPatty = await inventoryService.getInventoryItem(testPatty.id);
  console.log(`📊 Stock after order creation: ${afterOrderPatty.quantity} (Expected: 6)`);
  if (Number(afterOrderPatty.quantity) !== 6) {
    throw new Error(`Expected stock 6 after order creation, but got ${afterOrderPatty.quantity}`);
  }

  const createdOrder = await orderService.getOrderById(order.id);
  console.log(`✓ Order items inventoryDeducted flag:`, createdOrder.items.map(i => ({ name: i.name, deducted: i.inventoryDeducted })));
  if (!createdOrder.items.every(i => i.inventoryDeducted === true)) {
    throw new Error('Expected all order items to have inventoryDeducted = true');
  }

  // 4. Cancel the order -> should restore 4 patties (6 -> 10)
  console.log('🚫 Step 2: Cancelling order...');
  const cancelledOrder = await orderService.cancelOrder(order.id, 'Customer changed order');
  console.log(`✓ Order status updated to: ${cancelledOrder.status}`);

  const afterCancelPatty = await inventoryService.getInventoryItem(testPatty.id);
  console.log(`📊 Stock after cancellation: ${afterCancelPatty.quantity} (Expected: 10)`);
  if (Number(afterCancelPatty.quantity) !== 10) {
    throw new Error(`Expected stock 10 after cancellation, but got ${afterCancelPatty.quantity}`);
  }

  const reloadedCancelledOrder = await orderService.getOrderById(order.id);
  console.log(`✓ Order items inventoryDeducted flag after cancel:`, reloadedCancelledOrder.items.map(i => ({ name: i.name, deducted: i.inventoryDeducted })));
  if (!reloadedCancelledOrder.items.every(i => i.inventoryDeducted === false)) {
    throw new Error('Expected all order items to have inventoryDeducted = false after cancellation');
  }

  // 5. Try cancelling again -> stock must remain 10 (no double-restocking)
  console.log('🔁 Step 3: Attempting duplicate cancellation on already cancelled order...');
  await orderService.cancelOrder(order.id, 'Second cancel attempt');

  const afterSecondCancelPatty = await inventoryService.getInventoryItem(testPatty.id);
  console.log(`📊 Stock after second cancellation: ${afterSecondCancelPatty.quantity} (Expected: 10)`);
  if (Number(afterSecondCancelPatty.quantity) !== 10) {
    throw new Error(`Double-restock detected! Expected stock 10, but got ${afterSecondCancelPatty.quantity}`);
  }

  // 6. Check transactions
  const txs = await inventoryService.getInventoryTransactions(testPatty.id);
  console.log(`📜 Transaction Log:`, txs.map(t => `${t.type}: ${t.quantity} (${t.reason})`));

  const usageTx = txs.filter(t => t.type === 'USAGE');
  const restockTx = txs.filter(t => t.type === 'RESTOCK' && t.reason && t.reason.includes('Cancelled'));

  if (usageTx.length !== 1 || Number(usageTx[0].quantity) !== 4) {
    throw new Error('Incorrect USAGE transaction');
  }
  if (restockTx.length !== 1 || Number(restockTx[0].quantity) !== 4) {
    throw new Error('Incorrect RESTOCK transaction count or quantity (should be exactly 1 restock tx of 4)');
  }

  console.log('🧹 Cleaning up test records...');
  await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
  await prisma.order.delete({ where: { id: order.id } });
  await prisma.menuItemIngredient.deleteMany({ where: { menuItemId: burger.id } });
  await prisma.menuItem.delete({ where: { id: burger.id } });
  await prisma.inventoryTransaction.deleteMany({ where: { inventoryItemId: testPatty.id } });
  await prisma.inventoryItem.delete({ where: { id: testPatty.id } });

  console.log('🎉 ALL CANCELLATION RESTORATION & DEDUCTION TESTS PASSED WITH 100% ACCURACY!');
}

testCancellationInventoryRestoration()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  });
