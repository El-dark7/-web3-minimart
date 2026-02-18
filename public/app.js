const tg = window.Telegram.WebApp;
tg.expand();

let productsCache = [];
let cart = {}; // object keyed by productId

/* ========================
   LOAD PRODUCTS
======================== */

async function loadProducts() {
  const res = await fetch("/api/products");
  productsCache = await res.json();

  const root = document.getElementById("products");
  root.innerHTML = "";

  productsCache.forEach(p => {
    const div = document.createElement("div");
    div.className = "product";

    div.innerHTML = `
      <h3>${p.name}</h3>
      <p>KES ${p.price}</p>
      <div id="controls-${p.id}">
        <button onclick="addToCart(${p.id})">Add</button>
      </div>
    `;

    root.appendChild(div);
  });
}

/* ========================
   CART LOGIC
======================== */

function addToCart(id) {
  const product = productsCache.find(p => p.id === id);

  if (!cart[id]) {
    cart[id] = { ...product, qty: 1 };
  } else {
    cart[id].qty++;
  }

  updateProductControls(id);
  updateMainButton();
}

function increaseQty(id) {
  cart[id].qty++;
  updateProductControls(id);
  updateMainButton();
}

function decreaseQty(id) {
  cart[id].qty--;

  if (cart[id].qty <= 0) {
    delete cart[id];
  }

  updateProductControls(id);
  updateMainButton();
}

/* ========================
   UI UPDATES
======================== */

function updateProductControls(id) {
  const container = document.getElementById(`controls-${id}`);

  if (!cart[id]) {
    container.innerHTML =
      `<button onclick="addToCart(${id})">Add</button>`;
  } else {
    container.innerHTML = `
      <button onclick="decreaseQty(${id})">-</button>
      <span style="margin:0 10px">${cart[id].qty}</span>
      <button onclick="increaseQty(${id})">+</button>
    `;
  }
}

function updateMainButton() {
  const items = Object.values(cart);

  if (!items.length) {
    tg.MainButton.hide();
    return;
  }

  const totalQty = items.reduce((s, i) => s + i.qty, 0);
  const totalPrice = items.reduce((s, i) => s + (i.price * i.qty), 0);

  tg.MainButton.setText(
    `Checkout (${totalQty} items - KES ${totalPrice})`
  );

  tg.MainButton.show();
}

/* ========================
   CHECKOUT
======================== */

tg.MainButton.onClick(async () => {
  const items = Object.values(cart);

  const res = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items,
      chatId: tg.initDataUnsafe?.user?.id || "web-user"
    })
  });

  const data = await res.json();

  tg.showAlert("Order placed: " + data.id);

  cart = {};
  loadProducts();
  tg.MainButton.hide();
});

/* ======================== */

loadProducts();
