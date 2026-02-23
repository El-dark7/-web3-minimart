Run `npm install` then:

- `npm run start:all` to run server + bot
- `npm run dev:all` for watch mode
- Set `NO_DB_MODE=1` in `.env` for temporary no-Postgres mode

Pages:

- Customer app: `/`
- Admin panel: `/admin`
- Rider dashboard: `/rider`

Order lifecycle:

`CREATED -> CONFIRMED -> PREPARING -> READY_FOR_PICKUP -> ASSIGNED -> PICKED_UP -> ON_THE_WAY -> DELIVERED -> COMPLETED`

Customer confirms final delivery using the `deliveryCode`.

Check current storage mode:

- `GET /api/storage-mode` returns `{"mode":"postgres"}` or `{"mode":"memory"}`.

Dispatch intelligence:

- Auto rider recommendation endpoint: `GET /api/dispatch/recommendation/:orderId`
- Admin can use `Auto Dispatch` for `READY_FOR_PICKUP` orders.
- Order flow automation can progress orders from `CREATED -> CONFIRMED -> PREPARING -> READY_FOR_PICKUP` based on timers.
- Batch dispatch endpoint: `POST /api/dispatch/run-batch`
- Dispatch queue endpoint: `GET /api/dispatch/queue`
- Dispatch prediction matrix endpoint: `GET /api/dispatch/predict/:orderId`
- Update order priority: `PATCH /api/orders/:id/priority`
- Ops automation endpoints:
  - `GET /api/ops/automation-status`
  - `POST /api/ops/flow-sweep`
- Auto batch dispatcher env:
  - `DISPATCH_AUTO_ENABLED=1`
  - `DISPATCH_INTERVAL_MS=15000`
  - `DISPATCH_BATCH_LIMIT=5`
  - `DISPATCH_ASSIGN_TIMEOUT_MS=180000`
  - `ORDER_FLOW_AUTO_ENABLED=1`
  - `ORDER_FLOW_INTERVAL_MS=10000`
  - `ORDER_FLOW_CONFIRM_DELAY_MS=15000`
  - `ORDER_FLOW_PREPARING_DELAY_MS=45000`
  - `ORDER_FLOW_READY_DELAY_MS=90000`
  - `SLA_CREATED_MS=900000`
  - `SLA_TRANSIT_MS=3600000`
  - `RIDER_ALPHA_SHIFT_START_HOUR=6`
  - `RIDER_ALPHA_SHIFT_END_HOUR=22`
  - `RIDER_BRAVO_SHIFT_START_HOUR=6`
  - `RIDER_BRAVO_SHIFT_END_HOUR=22`

Catalog scale:

- Product source: `server/data/products.js`
- Includes 80 products across `food`, `groceries`, `airbnb`, `errands`
- Each product now includes a professional `description`, rating metadata, and review volume

Real product photos:

- Put real images in `public/assets/products/real/`
- Name files with product slug from `server/data/products.js`:
  - Example: `smoky-beef-burger.jpg`
  - Example: `rice-5kg.png`
- Supported extensions: `.jpg`, `.jpeg`, `.png`, `.webp`
- Run `npm run photos:check` to see photo coverage + missing slug names
- Admin dashboard supports bulk photo upload directly from browser
- Photo APIs:
  - `POST /api/admin/upload-product-photo`
  - `GET /api/admin/photo-coverage`

Storefront experience:

- Marketplace-style UI with search, category filtering, sorting, and product cards
- Built-in cart checkout panel (desktop + mobile drawer)
- Live order tracking + delivery code confirmation in the same page

Telegram bot integration:

- Bot checkout now creates orders via backend `POST /api/orders` (source=`telegram`)
- Orders created from Telegram appear in admin dashboard and can be dispatched normally
- Optional envs:
  - `APP_API_BASE=http://127.0.0.1:10000`
  - `TELEGRAM_DEFAULT_ZONE=CBD`
