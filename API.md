# API Documentation

Complete REST API and WebSocket documentation for the Restaurant POS system.

## Base URL
```
http://localhost:3000/api
```

## Authentication

All protected endpoints require a JWT token in the Authorization header:
```
Authorization: Bearer <token>
```

### Auth Endpoints

#### Register
```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "firstName": "John",
  "lastName": "Doe",
  "restaurantId": "restaurant_id",
  "role": "SERVER"
}

Response: 201 Created
{
  "user": {
    "id": "user_id",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "SERVER"
  },
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc..."
}
```

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}

Response: 200 OK
{
  "user": { ... },
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc..."
}
```

#### Refresh Token
```http
POST /api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "eyJhbGc..."
}

Response: 200 OK
{
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc..."
}
```

## Tables

#### Get Tables by Floor Plan
```http
GET /api/tables/floor/:floorPlanId
Authorization: Bearer <token>

Response: 200 OK
[
  {
    "id": "table_id",
    "number": "T1",
    "capacity": 4,
    "status": "AVAILABLE",
    "x": 100,
    "y": 200,
    "orders": []
  }
]
```

#### Create Table
```http
POST /api/tables
Authorization: Bearer <token>
Content-Type: application/json

{
  "number": "T5",
  "floorPlanId": "floor_plan_id",
  "capacity": 4,
  "x": 300,
  "y": 400,
  "shape": "CIRCLE"
}

Response: 201 Created
```

#### Update Table Status
```http
PATCH /api/tables/:id/status
Authorization: Bearer <token>
Content-Type: application/json

{
  "status": "OCCUPIED"
}

Response: 200 OK
```

## Orders

#### Create Order
```http
POST /api/orders
Authorization: Bearer <token>
Content-Type: application/json

{
  "tableId": "table_id",
  "items": [
    {
      "menuItemId": "item_id",
      "quantity": 2,
      "notes": "No onions"
    }
  ],
  "notes": "Birthday celebration"
}

Response: 201 Created
{
  "id": "order_id",
  "tableId": "table_id",
  "status": "OPEN",
  "items": [...],
  "createdAt": "2024-01-01T12:00:00Z"
}
```

#### Get Order
```http
GET /api/orders/:id
Authorization: Bearer <token>

Response: 200 OK
{
  "id": "order_id",
  "table": { ... },
  "items": [...],
  "payments": [...],
  "status": "OPEN"
}
```

#### Add Items to Order
```http
POST /api/orders/:id/items
Authorization: Bearer <token>
Content-Type: application/json

{
  "items": [
    {
      "menuItemId": "item_id",
      "quantity": 1
    }
  ]
}

Response: 200 OK
```

#### Update Order Item Status
```http
PATCH /api/orders/items/:itemId/status
Authorization: Bearer <token>
Content-Type: application/json

{
  "status": "PREPARING"
}

Response: 200 OK
```

#### Complete Order
```http
POST /api/orders/:id/complete
Authorization: Bearer <token>

Response: 200 OK
```

#### Cancel Order
```http
POST /api/orders/:id/cancel
Authorization: Bearer <token>
Content-Type: application/json

{
  "reason": "Customer left"
}

Response: 200 OK
```

## Menu

#### Get Restaurant Menu
```http
GET /api/menu/restaurant/:restaurantId
Authorization: Bearer <token>

Response: 200 OK
[
  {
    "id": "category_id",
    "name": "Appetizers",
    "items": [
      {
        "id": "item_id",
        "name": "Spring Rolls",
        "price": 8.99,
        "description": "Fresh vegetable spring rolls",
        "isAvailable": true
      }
    ]
  }
]
```

#### Create Menu Item
```http
POST /api/menu/items
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Pasta Carbonara",
  "description": "Classic Italian pasta",
  "price": 15.99,
  "categoryId": "category_id",
  "preparationTime": 20,
  "calories": 650,
  "allergens": ["dairy", "gluten"]
}

Response: 201 Created
```

## Payments

#### Create Payment Intent
```http
POST /api/payments/intent
Authorization: Bearer <token>
Content-Type: application/json

{
  "amount": 45.50,
  "customerId": "customer_id"
}

Response: 200 OK
{
  "clientSecret": "pi_xxx_secret_xxx"
}
```

#### Confirm Payment
```http
POST /api/payments/:id/confirm
Authorization: Bearer <token>

Response: 200 OK
{
  "id": "payment_id",
  "status": "COMPLETED",
  "amount": 45.50
}
```

#### Split Bill
```http
POST /api/payments/split
Authorization: Bearer <token>
Content-Type: application/json

{
  "orderId": "order_id",
  "splits": [
    { "amount": 22.75, "customerId": "customer_1" },
    { "amount": 22.75, "customerId": "customer_2" }
  ]
}

Response: 200 OK
[
  { "id": "payment_1", ... },
  { "id": "payment_2", ... }
]
```

## Inventory

#### Get Inventory Items
```http
GET /api/inventory/restaurant/:restaurantId
Authorization: Bearer <token>

Response: 200 OK
[
  {
    "id": "item_id",
    "name": "Tomatoes",
    "currentStock": 50,
    "minStock": 20,
    "unit": "kg",
    "costPerUnit": 3.50
  }
]
```

#### Adjust Stock
```http
POST /api/inventory/:id/adjust
Authorization: Bearer <token>
Content-Type: application/json

{
  "quantity": -5,
  "reason": "Used in preparation"
}

Response: 200 OK
{
  "id": "item_id",
  "currentStock": 45
}
```

#### Get Low Stock Items
```http
GET /api/inventory/restaurant/:restaurantId/low-stock
Authorization: Bearer <token>

Response: 200 OK
[
  {
    "id": "item_id",
    "name": "Chicken",
    "currentStock": 10,
    "minStock": 20
  }
]
```

## Employees

#### Get Employees
```http
GET /api/employees/restaurant/:restaurantId
Authorization: Bearer <token>
Roles: ADMIN, MANAGER

Response: 200 OK
[
  {
    "id": "employee_id",
    "email": "employee@example.com",
    "firstName": "Jane",
    "lastName": "Smith",
    "role": "SERVER",
    "isActive": true,
    "hourlyRate": 15.00
  }
]
```

#### Create Employee
```http
POST /api/employees
Authorization: Bearer <token>
Roles: ADMIN, MANAGER
Content-Type: application/json

{
  "email": "new@example.com",
  "password": "password123",
  "firstName": "Mike",
  "lastName": "Johnson",
  "restaurantId": "restaurant_id",
  "role": "CHEF",
  "hourlyRate": 18.00
}

Response: 201 Created
```

#### Clock In
```http
POST /api/employees/:id/clock-in
Authorization: Bearer <token>

Response: 200 OK
{
  "id": "shift_id",
  "employeeId": "employee_id",
  "clockIn": "2024-01-01T09:00:00Z"
}
```

#### Clock Out
```http
POST /api/employees/:id/clock-out
Authorization: Bearer <token>

Response: 200 OK
{
  "id": "shift_id",
  "clockIn": "2024-01-01T09:00:00Z",
  "clockOut": "2024-01-01T17:00:00Z",
  "hoursWorked": 8.0
}
```

## Analytics

#### Get Sales Analytics
```http
GET /api/analytics/sales/:restaurantId?startDate=2024-01-01&endDate=2024-01-31
Authorization: Bearer <token>
Roles: ADMIN, MANAGER

Response: 200 OK
{
  "totalRevenue": 15420.50,
  "totalOrders": 342,
  "averageOrderValue": 45.09,
  "itemsSold": 1245
}
```

#### Get Top Selling Items
```http
GET /api/analytics/top-items/:restaurantId?startDate=2024-01-01&endDate=2024-01-31&limit=10
Authorization: Bearer <token>
Roles: ADMIN, MANAGER

Response: 200 OK
[
  {
    "name": "Margherita Pizza",
    "quantity": 156,
    "revenue": 2340.00
  },
  ...
]
```

#### Get Dashboard Summary
```http
GET /api/analytics/dashboard/:restaurantId
Authorization: Bearer <token>
Roles: ADMIN, MANAGER

Response: 200 OK
{
  "todayRevenue": 1245.50,
  "todayOrders": 28,
  "activeOrders": 5,
  "lowStockItems": 3,
  "activeEmployees": 8
}
```

## WebSocket Events

### Connection
```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  auth: {
    token: 'your-jwt-token'
  },
  query: {
    restaurantId: 'restaurant_id'
  }
});
```

### Client Events (Emit)

#### Update Table
```javascript
socket.emit('table:update', {
  tableId: 'table_id',
  x: 150,
  y: 250
});
```

#### Update Table Status
```javascript
socket.emit('table:status', {
  tableId: 'table_id',
  status: 'OCCUPIED'
});
```

#### New Order Created
```javascript
socket.emit('order:created', {
  orderId: 'order_id',
  tableId: 'table_id'
});
```

#### Join Kitchen Display
```javascript
socket.emit('kitchen:join');
```

#### Mark Item Complete
```javascript
socket.emit('kitchen:item:complete', {
  itemId: 'item_id',
  status: 'READY'
});
```

### Server Events (Listen)

#### Table Updated
```javascript
socket.on('table:updated', (data) => {
  console.log('Table updated:', data);
});
```

#### New Order
```javascript
socket.on('order:new', (order) => {
  console.log('New order received:', order);
});
```

#### Order Updated
```javascript
socket.on('order:updated', (order) => {
  console.log('Order updated:', order);
});
```

#### Item Status Changed
```javascript
socket.on('order:item:status:changed', (data) => {
  console.log('Item status:', data);
});
```

#### Kitchen Order Updates
```javascript
socket.on('kitchen:order:new', (order) => {
  console.log('New kitchen order:', order);
});

socket.on('kitchen:item:completed', (data) => {
  console.log('Item ready:', data);
});
```

#### Inventory Alerts
```javascript
socket.on('inventory:alert', (alert) => {
  console.log('Low stock alert:', alert);
});
```

## Error Responses

All endpoints may return these error responses:

#### 400 Bad Request
```json
{
  "error": "Validation error",
  "message": "Invalid input data"
}
```

#### 401 Unauthorized
```json
{
  "error": "Authentication required"
}
```

#### 403 Forbidden
```json
{
  "error": "Insufficient permissions"
}
```

#### 404 Not Found
```json
{
  "error": "Resource not found"
}
```

#### 500 Internal Server Error
```json
{
  "error": "Internal server error"
}
```

## Rate Limiting

API requests are limited to:
- 100 requests per minute for authenticated users
- 20 requests per minute for unauthenticated endpoints

## Pagination

List endpoints support pagination via query parameters:
```
GET /api/orders?page=1&limit=20
```

Response includes pagination metadata:
```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```
