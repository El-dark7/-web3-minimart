const tg = window.Telegram.WebApp;
tg.expand();

const cart = [];

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
      <button onclick="addToCart(${p.id})">Add to Cart</button>
    `;

    root.appendChild(div);
  });
}

function addToCart(id) {
  fetch("/api/products")
    .then(r => r.json())
    .then(products => {
      const item = products.find(p => p.id === id);
      cart.push(item);

      tg.MainButton.setText(`Checkout (${cart.length})`);
      tg.MainButton.show();
    });
}

tg.MainButton.onClick(async () => {
  const res = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: cart,
      chatId: tg.initDataUnsafe?.user?.id || "web-user"
    })
  });

  const data = await res.json();

  tg.showAlert("Order placed: " + data.id);
  tg.MainButton.hide();
});

loadProducts();
