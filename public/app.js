const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (tg && tg.expand) tg.expand();

let productsCache = [];
let cart = {};
let activeOrderId = null;
let activeOrder = null;
let selectedCategory = "all";
let refreshInFlight = false;

const chatId = String((tg && tg.initDataUnsafe?.user?.id) || "web-user");

const productsRoot = document.getElementById("products");
const categoryTabs = document.getElementById("categoryTabs");
const resultCount = document.getElementById("resultCount");
const searchInput = document.getElementById("searchInput");
const sortSelect = document.getElementById("sortSelect");
const zoneSelect = document.getElementById("zoneSelect");
const cartToggle = document.getElementById("cartToggle");
const cartPanel = document.getElementById("cartPanel");
const cartItems = document.getElementById("cartItems");
const cartCount = document.getElementById("cartCount");
const cartSubtotal = document.getElementById("cartSubtotal");
const cartService = document.getElementById("cartService");
const cartTotal = document.getElementById("cartTotal");
const checkoutBtn = document.getElementById("checkoutBtn");
const refreshBtn = document.getElementById("refreshBtn");
const syncStamp = document.getElementById("syncStamp");

const orderBox = document.getElementById("orderBox");
const orderText = document.getElementById("orderText");
const deliveryCodeInput = document.getElementById("deliveryCodeInput");
const confirmBtn = document.getElementById("confirmBtn");

function notify(message) {
  if (tg && tg.showAlert) tg.showAlert(message);
  else window.alert(message);
}

function setSyncStamp(prefix = "Last sync") {
  if (!syncStamp) return;
  syncStamp.textContent = `${prefix}: ${new Date().toLocaleTimeString()}`;
}

function setRefreshLoading(isLoading) {
  if (!refreshBtn) return;
  refreshBtn.disabled = isLoading;
  refreshBtn.classList.toggle("loading", isLoading);
  refreshBtn.textContent = isLoading ? "Refreshing..." : "Refresh Catalog";
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString();
}

function getCartItems() {
  return Object.values(cart);
}

function getTotalQty() {
  return getCartItems().reduce((sum, item) => sum + item.qty, 0);
}

function getSubtotal() {
  return getCartItems().reduce((sum, item) => sum + item.price * item.qty, 0);
}

function serviceFee(subtotal) {
  if (!subtotal) return 0;
  return Math.max(80, Math.round(subtotal * 0.03));
}

function updateTelegramMainButton() {
  if (!tg || !tg.MainButton) return;
  const qty = getTotalQty();
  const subtotal = getSubtotal();
  if (!qty) {
    tg.MainButton.hide();
    return;
  }
  tg.MainButton.setText(`Checkout (${qty} items - KES ${formatMoney(subtotal)})`);
  tg.MainButton.show();
}

function renderCategoryTabs() {
  const categories = Array.from(new Set(productsCache.map((p) => p.category)));
  const tabs = ["all", ...categories];
  categoryTabs.innerHTML = tabs
    .map((cat) => {
      const active = selectedCategory === cat ? "active" : "";
      const label = cat === "all" ? "All" : cat[0].toUpperCase() + cat.slice(1);
      return `<button class="category-btn ${active}" onclick="setCategory('${cat}')">${label}</button>`;
    })
    .join("");
}

function filteredProducts() {
  const q = (searchInput.value || "").trim().toLowerCase();
  const sortBy = sortSelect.value;

  let list = productsCache.filter((p) => {
    if (selectedCategory !== "all" && p.category !== selectedCategory) return false;
    if (!q) return true;
    const matchText = `${p.name} ${p.description || ""} ${p.sku || ""}`.toLowerCase();
    return matchText.includes(q);
  });

  if (sortBy === "price_asc") list = list.sort((a, b) => a.price - b.price);
  else if (sortBy === "price_desc") list = list.sort((a, b) => b.price - a.price);
  else if (sortBy === "rating_desc") list = list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  else if (sortBy === "name_asc") list = list.sort((a, b) => a.name.localeCompare(b.name));
  else list = list.sort((a, b) => a.id - b.id);

  return list;
}

function controlMarkup(productId) {
  const item = cart[productId];
  if (!item) return `<button class="add-btn" onclick="addToCart(${productId})">Add to Cart</button>`;
  return `
    <div class="qty-box">
      <button onclick="decreaseQty(${productId})">-</button>
      <strong>${item.qty}</strong>
      <button onclick="increaseQty(${productId})">+</button>
    </div>
  `;
}

function renderProducts() {
  const list = filteredProducts();
  resultCount.textContent = `${list.length} item${list.length === 1 ? "" : "s"} found`;

  productsRoot.innerHTML = list.map((p) => {
    const fallbackImage = `/assets/products/${p.category}.svg`;
    const etaLabel = p.etaMinutes ? `${p.etaMinutes}-${p.etaMinutes + 10} min` : "Scheduled stay";
    return `
      <article class="product-card">
        <img src="${p.image || fallbackImage}" alt="${p.name}" class="product-image" loading="lazy" onerror="this.onerror=null;this.src='${fallbackImage}'" />
        <div class="product-body">
          <span class="category-pill">${p.category}</span>
          <h4 class="product-name">${p.name}</h4>
          <p class="product-desc">${p.description || "Reliable quality item with fast fulfillment and verified handling."}</p>
          <div class="meta-row">
            <span>⭐ ${p.rating || 4.5} (${formatMoney(p.reviews || 0)} reviews)</span>
            <span>${etaLabel}</span>
          </div>
          <div class="price-row">
            <span class="price">KES ${formatMoney(p.price)}</span>
            ${controlMarkup(p.id)}
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function renderCart() {
  const items = getCartItems();
  const subtotal = getSubtotal();
  const fee = serviceFee(subtotal);
  const total = subtotal + fee;

  cartCount.textContent = String(getTotalQty());
  cartSubtotal.textContent = `KES ${formatMoney(subtotal)}`;
  cartService.textContent = `KES ${formatMoney(fee)}`;
  cartTotal.textContent = `KES ${formatMoney(total)}`;
  checkoutBtn.disabled = items.length === 0;

  if (!items.length) {
    cartItems.innerHTML = `<p class="empty-cart">Your cart is empty. Add products to continue checkout.</p>`;
  } else {
    cartItems.innerHTML = items.map((item) => {
      const fallbackImage = `/assets/products/${item.category}.svg`;
      return `
        <div class="cart-item">
          <img src="${item.image || fallbackImage}" alt="${item.name}" onerror="this.onerror=null;this.src='${fallbackImage}'" />
          <div>
            <h4>${item.name}</h4>
            <p>KES ${formatMoney(item.price)} each</p>
            <div class="qty-box">
              <button onclick="decreaseQty(${item.id})">-</button>
              <strong>${item.qty}</strong>
              <button onclick="increaseQty(${item.id})">+</button>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  updateTelegramMainButton();
}

function syncUI() {
  renderCategoryTabs();
  renderProducts();
  renderCart();
}

function addToCart(id) {
  const product = productsCache.find((p) => p.id === id);
  if (!product) return;
  if (!cart[id]) cart[id] = { ...product, qty: 1 };
  else cart[id].qty += 1;
  syncUI();
}

function increaseQty(id) {
  if (!cart[id]) return;
  cart[id].qty += 1;
  syncUI();
}

function decreaseQty(id) {
  if (!cart[id]) return;
  cart[id].qty -= 1;
  if (cart[id].qty <= 0) delete cart[id];
  syncUI();
}

function setCategory(category) {
  selectedCategory = category;
  renderCategoryTabs();
  renderProducts();
}

function renderOrderBox(order) {
  activeOrder = order;
  activeOrderId = order.id;
  orderBox.classList.remove("hidden");

  orderText.textContent = `#${order.id} | Zone: ${order.zone || "CBD"} | Status: ${order.status} | Total: KES ${formatMoney(order.total)} | Code: ${order.deliveryCode}`;
  confirmBtn.disabled = order.status !== "DELIVERED";
}

async function fetchOrder(orderId) {
  const res = await fetch(`/api/orders/${orderId}`);
  if (!res.ok) return;
  const order = await res.json();
  renderOrderBox(order);
}

async function pollOrder() {
  if (!activeOrderId) return;
  await fetchOrder(activeOrderId);
  if (activeOrder?.status === "COMPLETED" || activeOrder?.status === "CANCELLED") {
    activeOrderId = null;
  }
}

async function checkoutFromCart() {
  const items = getCartItems();
  if (!items.length) return;

  checkoutBtn.disabled = true;
  try {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items,
        chatId,
        zone: zoneSelect?.value || "CBD"
      })
    });

    const data = await res.json();
    if (!res.ok) {
      notify(data.error || "Order creation failed");
      return;
    }

    notify(`Order placed: ${data.id}. Delivery code: ${data.deliveryCode}`);
    cart = {};
    renderOrderBox(data);
    syncUI();
  } catch (error) {
    notify(`Checkout error: ${error.message}`);
  } finally {
    checkoutBtn.disabled = false;
  }
}

async function confirmDelivery() {
  if (!activeOrderId) return;
  const code = deliveryCodeInput.value.trim();
  if (!code) {
    notify("Enter delivery code");
    return;
  }

  const res = await fetch(`/api/orders/${activeOrderId}/confirm-delivery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, chatId })
  });

  const data = await res.json();
  if (!res.ok) {
    notify(data.error || "Confirmation failed");
    return;
  }

  deliveryCodeInput.value = "";
  renderOrderBox(data);
  notify(`Order ${data.id} completed`);
}

async function loadProducts() {
  const res = await fetch("/api/products");
  const data = await res.json().catch(() => []);
  if (!res.ok) {
    throw new Error(data.error || "Failed to load catalog");
  }
  productsCache = Array.isArray(data) ? data : [];
  syncUI();
}

async function refreshStorefront() {
  if (refreshInFlight) return;
  refreshInFlight = true;
  setRefreshLoading(true);
  try {
    await loadProducts();
    if (activeOrderId) await fetchOrder(activeOrderId);
    setSyncStamp("Last sync");
  } catch (error) {
    notify(`Refresh failed: ${error.message}`);
  } finally {
    setRefreshLoading(false);
    refreshInFlight = false;
  }
}

searchInput.addEventListener("input", renderProducts);
sortSelect.addEventListener("change", renderProducts);

cartToggle.addEventListener("click", () => {
  cartPanel.classList.toggle("open");
});

if (refreshBtn) {
  refreshBtn.addEventListener("click", refreshStorefront);
}

if (tg && tg.MainButton) {
  tg.MainButton.onClick(checkoutFromCart);
}

refreshStorefront();
setInterval(pollOrder, 4000);
