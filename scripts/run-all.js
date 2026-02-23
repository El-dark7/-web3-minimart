const { spawn } = require("child_process");

const watchMode = process.argv.includes("--watch");
const nodeArgs = watchMode ? ["--watch"] : [];

const processes = [
  {
    name: "server",
    child: spawn(process.execPath, [...nodeArgs, "server/app.js"], {
      stdio: "inherit"
    })
  },
  {
    name: "bot",
    child: spawn(process.execPath, [...nodeArgs, "server/bot.js"], {
      stdio: "inherit"
    })
  }
];

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of processes) {
    if (!child.killed) child.kill("SIGINT");
  }
  process.exit(code);
}

for (const { name, child } of processes) {
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    if (signal || code !== 0) {
      console.error(`[${name}] exited unexpectedly (code=${code}, signal=${signal})`);
      shutdown(code || 1);
    }
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
