const socket = io();

const root = document.getElementById("orders");
const orderMap = {};

function renderOrder(order) {
  let div = orderMap[order.id];

  if (!div) {
    div = document.createElement("div");
    div.className = "order";
    root.prepend(div);
    orderMap[order.id] = div;
  }

  div.innerHTML = `
    <strong>${order.id}</strong><br>
    Status: ${order.status}<br>
    Total: KES ${order.total}<br>
    Created: ${new Date(order.createdAt).toLocaleString()}<br>
    <button onclick="updateStatus('${order.id}', 'PAID')">Mark Paid</button>
    <button onclick="updateStatus('${order.id}', 'ON_THE_WAY')">Dispatch</button>
    <button onclick="updateStatus('${order.id}', 'COMPLETED')">Complete</button>
  `;
}

socket.on("new_order", (order) => {
  renderOrder(order);
});

socket.on("order_updated", (order) => {
  renderOrder(order);
});

async function updateStatus(id, status) {
  await fetch(`/api/orders/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
}
