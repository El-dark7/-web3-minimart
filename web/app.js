// Telegram WebApp bootstrap
const tg = window.Telegram.WebApp;
tg.expand();

// In-memory cart (session only)
const cart = [];

/* =========================
   LOAD PRODUCTS
========================= */
async function loadProducts() {
  const res = await fetch("/api/products");
  const products = await res.json();

  const root = document.getElementById("products");
  root.innerHTML = "";

  products.forEach(p => {
    const div = document.createElement("div");
    div.className = "product";
    div.innerHTML = `
      <h3>${p.name}</h3>
      <p>KES ${p.price}</p>
      <button onclick="addToCart(${p.id})">Buy</button>
    `;
    root.appendChild(div);
  });
}

/* =========================
   ADD TO CART
========================= */
async function addToCart(id) {
  const res = await fetch("/api/products");
  const products = await res.json();

  const item = products.find(p => p.id === id);
  if (!item) return;

  cart.push(item);

  tg.MainButton.setText(`Checkout (${cart.length})`);
  tg.MainButton.show();
}

/* =========================
   CHECKOUT → CREATE ORDER
========================= */
tg.MainButton.onClick(async () => {
  if (!cart.length) return;

  const payload = {
    items: cart,
    chatId: tg.initDataUnsafe?.user?.id
  };

  const res = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const order = await res.json();

  // Notify Telegram bot
  tg.sendData(JSON.stringify({
    orderId: order.id
  }));

  tg.MainButton.hide();
  alert(`Order ${order.id} created`);
});

/* =========================
   INIT
========================= */
loadProducts();
