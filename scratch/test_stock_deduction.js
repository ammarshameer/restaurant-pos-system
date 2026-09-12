const path = require('path');
const { PrismaClient } = require(path.join(__dirname, '../apps/backend/node_modules/@prisma/client'));
const prisma = new PrismaClient();

const { OrderService } = require('../apps/backend/dist/services/order.service');
const { InventoryService } = require('../apps/backend/dist/services/inventory.service');

async function testInventoryDeduction() {
  console.log('🧪 Testing auto stock deduction for "thai piece" in "Zinger Burger"...');

  const restaurantId = 'rest-default-1';
  const orderService = new OrderService();
  const inventoryService = new InventoryService();

  // 1. Create or clean up test inventory item "thai piece"
  await prisma.inventoryTransaction.deleteMany({
    where: { inventoryItem: { name: 'thai piece' } }
  });
  await prisma.inventoryItem.deleteMany({
    where: { name: 'thai piece' }
  });

  const thaiPiece = await inventoryService.createInventoryItem({
    name: 'thai piece',
    unit: 'pcs',
    quantity: 10,
    reorderPoint: 3,
    costPerUnit: 180,
    restaurantId,
    category: 'Meat'
  });

  console.log(`✓ Created Inventory Item: "${thaiPiece.name}" with Initial Stock = ${thaiPiece.quantity}`);

  // 2. Create or verify Menu Item "Zinger Burger" with description mentioning "thai piece"
  let zinger = await prisma.menuItem.findFirst({
    where: { name: 'Zinger Burger' }
  });

  if (!zinger) {
    let cat = await prisma.category.findFirst({ where: { restaurantId } });
    if (!cat) {
      cat = await prisma.category.create({ data: { name: 'Burgers', restaurantId } });
    }
    zinger = await prisma.menuItem.create({
      data: {
        name: 'Zinger Burger',
        description: 'Crispy fried burger prepared with marinated thai piece, mayo, and lettuce',
        price: 550,
        cost: 220,
        categoryId: cat.id,
        restaurantId,
      }
    });
  } else {
    zinger = await prisma.menuItem.update({
      where: { id: zinger.id },
      data: {
        description: 'Crispy fried burger prepared with marinated thai piece, mayo, and lettuce',
      }
    });
  }

  console.log(`✓ Menu Item: "${zinger.name}" (Description: "${zinger.description}")`);

  // 3. Place an order for 1x Zinger Burger
  console.log('🛒 Placing order for 1x Zinger Burger on POS...');
  const order = await orderService.createOrder({
    orderNumber: 99999,
    orderType: 'DINE_IN',
    restaurantId,
    paymentStatus: 'PAID',
    items: [
      {
        menuItemId: zinger.id,
        name: zinger.name,
        quantity: 1,
        price: 550,
      }
    ]
  });

  console.log(`✓ Order #${order.orderNumber} created successfully!`);

  // 4. Verify inventory item quantity
  const updatedThaiPiece = await inventoryService.getInventoryItem(thaiPiece.id);
  console.log(`📊 Updated Stock Level for "${updatedThaiPiece.name}": ${updatedThaiPiece.quantity} ${updatedThaiPiece.unit}`);

  if (Number(updatedThaiPiece.quantity) === 9) {
    console.log('🎉 SUCCESS: Stock was accurately reduced from 10 to 9!');
  } else {
    throw new Error(`Expected stock 9, but got ${updatedThaiPiece.quantity}`);
  }

  // 5. Verify transaction log
  const txs = await inventoryService.getInventoryTransactions(thaiPiece.id);
  console.log(`📜 Transactions logged:`, txs.map(t => `${t.type}: ${t.quantity} (${t.reason})`));

  if (txs.some(t => t.type === 'USAGE' && t.quantity === 1)) {
    console.log('✓ USAGE transaction properly registered in audit history!');
  } else {
    throw new Error('Missing USAGE transaction in database');
  }

  // Clean up test order
  await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
  await prisma.order.delete({ where: { id: order.id } });
}

testInventoryDeduction()
  .then(() => {
    console.log('✅ Auto stock deduction verification completed with 100% success!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  });
