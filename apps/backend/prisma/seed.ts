import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting comprehensive database seed...');

  // 1. Create Default Restaurant
  const restaurant = await prisma.restaurant.upsert({
    where: { id: 'rest-default-1' },
    update: {},
    create: {
      id: 'rest-default-1',
      name: 'Gourmet Bistro & Grill',
      address: 'Main Boulevard, Gulberg III, Lahore',
      phone: '+92 (42) 3578-9000',
      email: 'contact@gourmetbistro.pk',
      timezone: 'Asia/Karachi',
    },
  });

  console.log(`✓ Restaurant created: ${restaurant.name}`);

  // 2. Create Default Floor Plan & Tables
  const floorPlan = await prisma.floorPlan.upsert({
    where: { id: 'fp-default-1' },
    update: {},
    create: {
      id: 'fp-default-1',
      name: 'Main Dining & Bar Area',
      restaurantId: restaurant.id,
      layout: JSON.stringify({ width: 1000, height: 800 }),
      isActive: true,
    },
  });

  const defaultTables = [
    { id: 't1', number: '1', capacity: 4, shape: 'SQUARE', status: 'AVAILABLE', x: 40, y: 40, width: 100, height: 100 },
    { id: 't2', number: '2', capacity: 2, shape: 'CIRCLE', status: 'OCCUPIED', x: 220, y: 40, width: 90, height: 90 },
    { id: 't3', number: '3', capacity: 6, shape: 'RECTANGLE', status: 'AVAILABLE', x: 380, y: 40, width: 140, height: 90 },
    { id: 't4', number: '4', capacity: 4, shape: 'BOOTH', status: 'DIRTY', x: 40, y: 220, width: 110, height: 110 },
    { id: 't5', number: '5', capacity: 4, shape: 'SQUARE', status: 'RESERVED', x: 220, y: 220, width: 100, height: 100 },
    { id: 't6', number: '6', capacity: 8, shape: 'RECTANGLE', status: 'AVAILABLE', x: 380, y: 220, width: 160, height: 100 },
    { id: 't7', number: 'B1', capacity: 1, shape: 'CIRCLE', status: 'AVAILABLE', x: 620, y: 40, width: 70, height: 70 },
    { id: 't8', number: 'B2', capacity: 1, shape: 'CIRCLE', status: 'OCCUPIED', x: 620, y: 140, width: 70, height: 70 },
    { id: 't9', number: 'B3', capacity: 1, shape: 'CIRCLE', status: 'AVAILABLE', x: 620, y: 240, width: 70, height: 70 },
  ];

  for (const t of defaultTables) {
    await prisma.table.upsert({
      where: { id: t.id },
      update: {
        number: t.number,
        capacity: t.capacity,
        shape: t.shape,
        status: t.status,
        x: t.x,
        y: t.y,
        width: t.width,
        height: t.height,
        floorPlanId: floorPlan.id,
      },
      create: {
        id: t.id,
        number: t.number,
        capacity: t.capacity,
        shape: t.shape,
        status: t.status,
        x: t.x,
        y: t.y,
        width: t.width,
        height: t.height,
        floorPlanId: floorPlan.id,
      },
    });
  }

  console.log('✓ Floor plan and 9 tables seeded');

  // 3. Create Default Employees (Manager, Admin, Server, Cashier, Kitchen, Bartender)
  const passwordHash = await bcrypt.hash('password123', 10);

  const manager = await prisma.employee.upsert({
    where: { email: 'manager@restaurant.com' },
    update: { passwordHash, restaurantId: restaurant.id },
    create: {
      id: 'emp-manager-1',
      email: 'manager@restaurant.com',
      firstName: 'Alex',
      lastName: 'Morgan',
      role: 'MANAGER',
      pin: '1234',
      phone: '+92 300 1234567',
      hourlyRate: 1000,
      passwordHash,
      restaurantId: restaurant.id,
      isActive: true,
    },
  });

  const admin = await prisma.employee.upsert({
    where: { email: 'admin@restaurant.com' },
    update: { passwordHash, restaurantId: restaurant.id },
    create: {
      id: 'emp-admin-1',
      email: 'admin@restaurant.com',
      firstName: 'Sarah',
      lastName: 'Jenkins',
      role: 'ADMIN',
      pin: '0000',
      phone: '+92 300 9998877',
      hourlyRate: 1200,
      passwordHash,
      restaurantId: restaurant.id,
      isActive: true,
    },
  });

  const server = await prisma.employee.upsert({
    where: { email: 'server@restaurant.com' },
    update: { passwordHash, restaurantId: restaurant.id },
    create: {
      id: 'emp-server-1',
      email: 'server@restaurant.com',
      firstName: 'Sam',
      lastName: 'Rivera',
      role: 'SERVER',
      pin: '5678',
      phone: '+92 321 2345678',
      hourlyRate: 650,
      passwordHash,
      restaurantId: restaurant.id,
      isActive: true,
    },
  });

  await prisma.employee.upsert({
    where: { email: 'kitchen@restaurant.com' },
    update: { passwordHash, restaurantId: restaurant.id },
    create: {
      id: 'emp-kitchen-1',
      email: 'kitchen@restaurant.com',
      firstName: 'Marco',
      lastName: 'Pierre',
      role: 'KITCHEN',
      pin: '3333',
      phone: '+92 333 3456789',
      hourlyRate: 850,
      passwordHash,
      restaurantId: restaurant.id,
      isActive: true,
    },
  });

  await prisma.employee.upsert({
    where: { email: 'cashier@restaurant.com' },
    update: { passwordHash, restaurantId: restaurant.id },
    create: {
      id: 'emp-cashier-1',
      email: 'cashier@restaurant.com',
      firstName: 'Taylor',
      lastName: 'Swift',
      role: 'CASHIER',
      pin: '4444',
      phone: '+92 345 4567890',
      hourlyRate: 600,
      passwordHash,
      restaurantId: restaurant.id,
      isActive: true,
    },
  });

  await prisma.employee.upsert({
    where: { email: 'bar@restaurant.com' },
    update: { passwordHash, restaurantId: restaurant.id },
    create: {
      id: 'emp-bar-1',
      email: 'bar@restaurant.com',
      firstName: 'Jordan',
      lastName: 'Lee',
      role: 'BARTENDER',
      pin: '5555',
      phone: '+92 301 5678901',
      hourlyRate: 700,
      passwordHash,
      restaurantId: restaurant.id,
      isActive: true,
    },
  });

  console.log('✓ Employees seeded (manager, admin, server, kitchen, cashier, bartender)');

  // 4. Create Categories
  const categoryNames = ['Burgers', 'Mains', 'Appetizers', 'Sides', 'Beverages', 'Desserts', 'Salads'];
  const categoryMap = new Map<string, string>();

  for (let i = 0; i < categoryNames.length; i++) {
    const name = categoryNames[i];
    let cat = await prisma.category.findFirst({
      where: { name, restaurantId: restaurant.id },
    });
    if (!cat) {
      cat = await prisma.category.create({
        data: {
          name,
          displayOrder: i,
          restaurantId: restaurant.id,
        },
      });
    }
    categoryMap.set(name, cat.id);
  }

  console.log('✓ Categories seeded');

  // 5. Create Menu Items
  const menuItemsData = [
    { id: 'm1', name: 'Classic Smash Burger', category: 'Burgers', price: 1299, cost: 450, preparationTime: 12, isAvailable: true, is86d: false, description: 'Double beef patty, aged cheddar, pickles, house secret sauce' },
    { id: 'm2', name: 'Truffle Bacon Burger', category: 'Burgers', price: 1549, cost: 580, preparationTime: 15, isAvailable: true, is86d: false, description: 'Smoked bacon, truffle aioli, sautéed onions, swiss cheese' },
    { id: 'm3', name: 'Crispy Buffalo Wings', category: 'Appetizers', price: 1099, cost: 380, preparationTime: 10, isAvailable: true, is86d: false, description: '8 crispy wings tossed in classic buffalo sauce with ranch' },
    { id: 'm4', name: 'Loaded Cheese Fries', category: 'Sides', price: 699, cost: 220, preparationTime: 8, isAvailable: true, is86d: false, description: 'Crinkle cut fries, melted cheddar, bacon crumbles, green onions' },
    { id: 'm5', name: 'Wood-Fired Margherita Pizza', category: 'Mains', price: 1499, cost: 480, preparationTime: 18, isAvailable: true, is86d: false, description: 'San Marzano tomatoes, fresh mozzarella, basil, olive oil' },
    { id: 'm6', name: 'Caesar Salad with Grilled Chicken', category: 'Salads', price: 1199, cost: 360, preparationTime: 8, isAvailable: true, is86d: false, description: 'Romaine hearts, parmesan, garlic croutons, house dressing' },
    { id: 'm7', name: 'Iced Artisan Caramel Latte', category: 'Beverages', price: 499, cost: 150, preparationTime: 4, isAvailable: true, is86d: false, description: 'Espresso, steamed milk, house-made salted caramel syrup' },
    { id: 'm8', name: 'Craft Root Beer Float', category: 'Beverages', price: 549, cost: 180, preparationTime: 3, isAvailable: true, is86d: false, description: 'Draft root beer with double scoop of vanilla bean ice cream' },
    { id: 'm9', name: 'Molten Chocolate Lava Cake', category: 'Desserts', price: 799, cost: 250, preparationTime: 10, isAvailable: false, is86d: true, description: 'Warm chocolate cake with liquid fudge center and berries' },
  ];

  for (const item of menuItemsData) {
    const categoryId = categoryMap.get(item.category) || Array.from(categoryMap.values())[0];
    await prisma.menuItem.upsert({
      where: { id: item.id },
      update: {
        name: item.name,
        price: item.price,
        cost: item.cost,
        preparationTime: item.preparationTime,
        isAvailable: item.isAvailable,
        is86d: item.is86d,
        description: item.description,
        categoryId,
        restaurantId: restaurant.id,
      },
      create: {
        id: item.id,
        name: item.name,
        price: item.price,
        cost: item.cost,
        preparationTime: item.preparationTime,
        isAvailable: item.isAvailable,
        is86d: item.is86d,
        description: item.description,
        categoryId,
        restaurantId: restaurant.id,
      },
    });
  }

  console.log('✓ Menu items seeded');

  // 6. Create Inventory Items & Transactions
  const inventoryData = [
    { id: 'inv-1', name: 'Fresh Angus Beef Patties', sku: 'BEEF-001', category: 'Meat', quantity: 18, unit: 'lbs', reorderPoint: 20, costPerUnit: 650 },
    { id: 'inv-2', name: 'Brioche Burger Buns', sku: 'BAKE-002', category: 'Bakery', quantity: 45, unit: 'pcs', reorderPoint: 30, costPerUnit: 95 },
    { id: 'inv-3', name: 'Aged White Cheddar Slices', sku: 'DAIRY-003', category: 'Dairy', quantity: 60, unit: 'slices', reorderPoint: 25, costPerUnit: 50 },
    { id: 'inv-4', name: 'Jumbo Chicken Wings', sku: 'MEAT-004', category: 'Meat', quantity: 12, unit: 'lbs', reorderPoint: 15, costPerUnit: 450 },
    { id: 'inv-5', name: 'Crinkle Cut Fries Bag', sku: 'FROZ-005', category: 'Frozen', quantity: 80, unit: 'lbs', reorderPoint: 40, costPerUnit: 180 },
    { id: 'inv-6', name: 'San Marzano Tomato Sauce', sku: 'GROC-006', category: 'Grocery', quantity: 24, unit: 'cans', reorderPoint: 10, costPerUnit: 350 },
    { id: 'inv-7', name: 'Artisan Espresso Beans', sku: 'BEV-007', category: 'Beverage', quantity: 5, unit: 'lbs', reorderPoint: 8, costPerUnit: 2200 },
    { id: 'inv-8', name: 'Craft Root Beer Syrup', sku: 'BEV-008', category: 'Beverage', quantity: 15, unit: 'liters', reorderPoint: 10, costPerUnit: 950 },
  ];

  for (const inv of inventoryData) {
    const item = await prisma.inventoryItem.upsert({
      where: { id: inv.id },
      update: {
        name: inv.name,
        sku: inv.sku,
        category: inv.category,
        quantity: inv.quantity,
        unit: inv.unit,
        reorderPoint: inv.reorderPoint,
        costPerUnit: inv.costPerUnit,
        restaurantId: restaurant.id,
      },
      create: {
        id: inv.id,
        name: inv.name,
        sku: inv.sku,
        category: inv.category,
        quantity: inv.quantity,
        unit: inv.unit,
        reorderPoint: inv.reorderPoint,
        costPerUnit: inv.costPerUnit,
        restaurantId: restaurant.id,
      },
    });

    // Check if initial transaction exists
    const txCount = await prisma.inventoryTransaction.count({
      where: { inventoryItemId: item.id },
    });
    if (txCount === 0) {
      await prisma.inventoryTransaction.create({
        data: {
          inventoryItemId: item.id,
          quantity: inv.quantity,
          type: 'RESTOCK',
          reason: 'Initial stock intake & system setup',
        },
      });
    }
  }

  console.log('✓ Inventory items & transactions seeded');

  // 7. Seed Orders with different dates (Today, Yesterday, Last Week, This Month)
  const now = new Date();
  const todayMorning = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 11, 30, 0);
  const todayAfternoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 15, 0);
  const todayEvening = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 19, 45, 0);

  const yesterdayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12, 30, 0);
  const yesterdayNight = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 20, 15, 0);

  const threeDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3, 13, 0, 0);
  const fiveDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 5, 18, 30, 0);

  const ordersToSeed = [
    // --- TODAY ORDERS ---
    {
      id: 'ORD-1001',
      orderNumber: 104,
      orderType: 'DINE_IN',
      orderTypeLabel: 'Dine In',
      dineInTag: 'Seat 2',
      tableId: 't2',
      serverId: server.id,
      subtotal: 3297,
      serviceCharge: 164.85,
      serviceChargeRate: 5,
      tax: 0,
      total: 3461.85,
      status: 'confirmed',
      paymentStatus: 'UNPAID',
      paymentMethod: 'DIRECT / DINE-IN',
      notes: 'Serve fries first',
      createdAt: todayMorning,
      items: [
        { menuItemId: 'm1', name: 'Classic Smash Burger', quantity: 2, unitPrice: 1299, price: 1299, total: 2598, notes: 'Extra pickles' },
        { menuItemId: 'm4', name: 'Loaded Cheese Fries', quantity: 1, unitPrice: 699, price: 699, total: 699 },
      ],
    },
    {
      id: 'ORD-1002',
      orderNumber: 105,
      orderType: 'TAKE_AWAY',
      orderTypeLabel: 'Take Away',
      customerName: 'Bilal Khan',
      customerPhone: '0300-5551234',
      serverId: manager.id,
      subtotal: 4097,
      serviceCharge: 0,
      serviceChargeRate: 0,
      tax: 0,
      total: 4097,
      totalPaid: 4097,
      change: 0,
      status: 'paid',
      paymentStatus: 'PAID',
      paymentMethod: 'CASH',
      createdAt: todayAfternoon,
      items: [
        { menuItemId: 'm5', name: 'Wood-Fired Margherita Pizza', quantity: 2, unitPrice: 1499, price: 1499, total: 2998 },
        { menuItemId: 'm3', name: 'Crispy Buffalo Wings', quantity: 1, unitPrice: 1099, price: 1099, total: 1099, notes: 'Extra ranch' },
      ],
    },
    {
      id: 'ORD-1003',
      orderNumber: 106,
      orderType: 'DELIVERY',
      orderTypeLabel: 'Delivery',
      customerName: 'Usman Tariq',
      customerPhone: '0321-9876543',
      deliveryAddress: 'House 42, Block H, DHA Phase 5, Lahore',
      serverId: manager.id,
      subtotal: 2098,
      serviceCharge: 0,
      serviceChargeRate: 0,
      tax: 0,
      total: 2098,
      totalPaid: 2098,
      change: 0,
      status: 'paid',
      paymentStatus: 'PAID',
      paymentMethod: 'CARD / VISA',
      createdAt: todayEvening,
      items: [
        { menuItemId: 'm2', name: 'Truffle Bacon Burger', quantity: 1, unitPrice: 1549, price: 1549, total: 1549 },
        { menuItemId: 'm8', name: 'Craft Root Beer Float', quantity: 1, unitPrice: 549, price: 549, total: 549 },
      ],
    },

    // --- YESTERDAY ORDERS ---
    {
      id: 'ORD-1004',
      orderNumber: 101,
      orderType: 'DINE_IN',
      orderTypeLabel: 'Dine In',
      dineInTag: 'Table 1',
      tableId: 't1',
      serverId: server.id,
      subtotal: 5196,
      serviceCharge: 259.80,
      serviceChargeRate: 5,
      tax: 0,
      total: 5455.80,
      totalPaid: 5455.80,
      change: 0,
      status: 'paid',
      paymentStatus: 'PAID',
      paymentMethod: 'CASH',
      createdAt: yesterdayNoon,
      items: [
        { menuItemId: 'm1', name: 'Classic Smash Burger', quantity: 4, unitPrice: 1299, price: 1299, total: 5196 },
      ],
    },
    {
      id: 'ORD-1005',
      orderNumber: 102,
      orderType: 'TAKE_AWAY',
      orderTypeLabel: 'Take Away',
      customerName: 'Zubair Ahmed',
      customerPhone: '0333-4445566',
      serverId: manager.id,
      subtotal: 3047,
      serviceCharge: 0,
      serviceChargeRate: 0,
      tax: 0,
      total: 3047,
      totalPaid: 3047,
      change: 0,
      status: 'paid',
      paymentStatus: 'PAID',
      paymentMethod: 'JAZZCASH',
      createdAt: yesterdayNight,
      items: [
        { menuItemId: 'm2', name: 'Truffle Bacon Burger', quantity: 1, unitPrice: 1549, price: 1549, total: 1549 },
        { menuItemId: 'm5', name: 'Wood-Fired Margherita Pizza', quantity: 1, unitPrice: 1499, price: 1499, total: 1499 },
      ],
    },

    // --- PAST 7 DAYS ORDERS ---
    {
      id: 'ORD-1006',
      orderNumber: 98,
      orderType: 'DINE_IN',
      orderTypeLabel: 'Dine In',
      dineInTag: 'Table 3',
      tableId: 't3',
      serverId: server.id,
      subtotal: 7495,
      serviceCharge: 374.75,
      serviceChargeRate: 5,
      tax: 0,
      total: 7869.75,
      totalPaid: 7869.75,
      change: 0,
      status: 'paid',
      paymentStatus: 'PAID',
      paymentMethod: 'CARD / VISA',
      createdAt: threeDaysAgo,
      items: [
        { menuItemId: 'm5', name: 'Wood-Fired Margherita Pizza', quantity: 5, unitPrice: 1499, price: 1499, total: 7495 },
      ],
    },
    {
      id: 'ORD-1007',
      orderNumber: 95,
      orderType: 'DELIVERY',
      orderTypeLabel: 'Delivery',
      customerName: 'Hassan Raza',
      customerPhone: '0300-8889900',
      deliveryAddress: 'Flat 4B, Mall Heights, Gulberg, Lahore',
      serverId: manager.id,
      subtotal: 4496,
      serviceCharge: 0,
      serviceChargeRate: 0,
      tax: 0,
      total: 4496,
      totalPaid: 4496,
      change: 0,
      status: 'paid',
      paymentStatus: 'PAID',
      paymentMethod: 'NAYAPAY',
      createdAt: fiveDaysAgo,
      items: [
        { menuItemId: 'm3', name: 'Crispy Buffalo Wings', quantity: 2, unitPrice: 1099, price: 1099, total: 2198 },
        { menuItemId: 'm6', name: 'Caesar Salad with Grilled Chicken', quantity: 1, unitPrice: 1199, price: 1199, total: 1199 },
        { menuItemId: 'm8', name: 'Craft Root Beer Float', quantity: 2, unitPrice: 549, price: 549, total: 1098 },
      ],
    },
  ];

  for (const o of ordersToSeed) {
    const existingOrder = await prisma.order.findUnique({
      where: { orderNumber: o.orderNumber },
    });

    if (!existingOrder) {
      await prisma.order.create({
        data: {
          id: o.id,
          orderNumber: o.orderNumber,
          orderType: o.orderType,
          orderTypeLabel: o.orderTypeLabel,
          customerName: o.customerName,
          customerPhone: o.customerPhone,
          deliveryAddress: o.deliveryAddress,
          dineInTag: o.dineInTag,
          tableId: o.tableId,
          serverId: o.serverId,
          restaurantId: restaurant.id,
          subtotal: o.subtotal,
          serviceCharge: o.serviceCharge,
          serviceChargeRate: o.serviceChargeRate,
          tax: o.tax,
          total: o.total,
          status: o.status,
          createdAt: o.createdAt,
          updatedAt: o.createdAt,
          items: {
            create: o.items.map((i) => ({
              menuItemId: i.menuItemId,
              name: i.name,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              price: i.price,
              total: i.total,
              notes: i.notes,
            })),
          },
          payments: o.paymentStatus === 'PAID' ? {
            create: {
              amount: o.totalPaid || o.total,
              method: o.paymentMethod || 'CASH',
              status: 'COMPLETED',
              processedAt: o.createdAt,
              createdAt: o.createdAt,
            }
          } : undefined,
        },
      });
    }
  }

  console.log('✓ Multi-day sample orders & payment records seeded');
  console.log('🎉 Database seeding complete!');
}

main()
  .catch((e) => {
    console.error('Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
