async function loadOrders() {
  const res = await fetch("/api/orders");
  const orders = await res.json();

  const root = document.getElementById("orders");
  root.innerHTML = "";

  orders.reverse().forEach(order => {
    const div = document.createElement("div");
    div.className = "order";

    div.innerHTML = `
      <strong>${order.id}</strong><br>
      Status: ${order.status}<br>
      Total: KES ${order.total}<br>
      Created: ${new Date(order.createdAt).toLocaleString()}<br>
      <button onclick="updateStatus('${order.id}', 'PAID')">Mark Paid</button>
      <button onclick="updateStatus('${order.id}', 'ON_THE_WAY')">Dispatch</button>
      <button onclick="updateStatus('${order.id}', 'COMPLETED')">Complete</button>
    `;

    root.appendChild(div);
  });
}

async function updateStatus(id, status) {
  await fetch(`/api/orders/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });

  loadOrders();
}

setInterval(loadOrders, 3000);
loadOrders();
