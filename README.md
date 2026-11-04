# Restaurant POS and Management System

A comprehensive, full-stack Point of Sale and management system for restaurants, built with modern technologies including React, Node.js, Express, PostgreSQL, and real-time WebSocket communication. Designed for offline and cash-first POS workflows.

## Features

### Core POS Functionality
- **Table Management**: Visual floor plan editor with drag-and-drop table positioning
- **Order Management**: Full order lifecycle from creation to completion with automatic inventory deduction
- **Menu Management**: Categorized menu items with modifiers, customization, and 86/out-of-stock toggling
- **Payment Processing**: Fast cash register terminal with denomination quick-buttons, change calculator, bill splitting, and 80mm thermal printable receipts
- **Kitchen Display System (KDS)**: Real-time order tracking with status updates for kitchen staff

### Management Features
- **Inventory Management**: Stock tracking with automated deduction on order completion, reorder alerts, stock adjustments, and full transaction history
- **Employee Management**: Staff roster, PIN-based quick switching, time clock (clock-in / clock-out), and hourly wage tracking
- **Analytics Dashboard**: Real-time sales metrics, hourly revenue charts, top-selling dishes, table occupancy, and labor cost reports
- **Real-time Updates**: WebSocket integration for live orders, KDS tickets, table statuses, and low-stock alerts

### Security
- JWT-based authentication with refresh tokens and PIN login support
- Role-based access control (Admin, Manager, Server, Kitchen, Cashier, Host)
- Secure password hashing with bcrypt
- Protected API routes with middleware

## Tech Stack

### Frontend
- **React 18** with TypeScript
- **Redux Toolkit** for state management
- **React Router 6** for seamless multi-page navigation
- **React Query** for server state management
- **Socket.IO Client** for real-time updates
- **Vite** for fast development and builds
- **Tailwind CSS & Vanilla Design System** with thermal receipt print styling

### Backend
- **Node.js** with Express
- **TypeScript** for type safety
- **Prisma ORM** with PostgreSQL database
- **Socket.IO** for WebSocket communication
- **JWT** for authentication

## Project Structure

```
restaurant-pos/
├── apps/
│   ├── backend/          # Express API server
│   │   ├── src/
│   │   │   ├── routes/   # API endpoints
│   │   │   ├── services/ # Business logic
│   │   │   ├── middleware/
│   │   │   └── types/
│   │   └── prisma/       # Database schema & migrations
│   └── frontend/         # React application
│       └── src/
│           ├── components/
│           ├── pages/
│           ├── hooks/
│           ├── store/
│           └── types/
├── API.md               # Complete API documentation
└── DEPLOYMENT.md        # Deployment guide
```

## Getting Started

See [DEPLOYMENT.md](./DEPLOYMENT.md) for complete setup and deployment instructions.

## Thermal printing

For an 80 mm ESC/POS printer (for example the Black Copper BC-88AC), three
direct-print channels are available; the receipt modal picks whatever exists:

- **USB printers** — Chromium browsers (Chrome/Edge) print straight to the
  printer over WebUSB. No install at all.
- **Local print agent** — a single ~8 MB binary (`apps/print-agent`, Go) that
  bridges any installed OS printer on Windows, Linux and macOS. The receipt
  modal offers a one-shot installer per platform.
- **Windows desktop app** — the packaged Electron POS prints natively with no
  extra install.

If none is available, Android browsers fall back to the system print dialog.

```bash
cd apps/print-agent && go build -o local-print-agent .   # run the agent manually
npm run print-helper:start   # legacy Windows print helper (Electron tray app)
npm run dist:print-helper    # build the helper installer + portable zip
```

See [apps/print-agent/README.md](./apps/print-agent/README.md) for the agent API
and configuration, and [electron/print-helper/README.md](./electron/print-helper/README.md)
for the legacy Windows helper.

## Documentation

- [API Documentation](./API.md) - Complete REST API and WebSocket reference
- [Deployment Guide](./DEPLOYMENT.md) - Production deployment instructions
- [Print Helper Guide](./electron/print-helper/README.md) - Windows ESC/POS printing

## License

MIT