-Run npm install then npm start. Set webhook to /webhook/telegram
\ No newline at end of file
+# Web3 MiniMart
+
+A Telegram + web-based minimart prototype with:
+- Customer storefront (`public/`)
+- Admin dashboard (`admin/`)
+- Express API (`server/app.js`)
+- Telegram bot (`server/bot.js`)
+
+## Quick start
+
+1. Install dependencies:
+```bash
+npm install
+```
+
+2. Copy env file and set values:
+```bash
+cp .env.example .env
+```
+
+3. Start API server:
+```bash
+npm start
+```
+
+4. (Optional) Run API + bot together:
+```bash
+npm run dev:all
+```
+
+## Useful scripts
+
+- `npm run dev:all` → start API + bot in one command.
+- `npm run smoke:api` → run quick API smoke checks (server must be running).
+
+## Project direction
+
+For a production-oriented roadmap, architecture guidance, and deployment ideas, read:
+
+- [`MINIMART_PRO_GUIDE.md`](./MINIMART_PRO_GUIDE.md)
 
EOF
)
