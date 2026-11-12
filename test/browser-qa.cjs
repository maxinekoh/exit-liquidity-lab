const { chromium } = require("playwright");
const fs = require("fs");
(async () => {
  const b = await chromium.launch({ headless: true, channel: "chrome" });
  const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route("**/qa-rpc", async (route) => {
    const response = await fetch("http://127.0.0.1:18545", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: route.request().postData(),
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: await response.text(),
    });
  });
  await p.addInitScript(() => {
    window.ethereum = {
      request: async ({ method, params = [] }) => {
        const r = await fetch("/qa-rpc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: method === "eth_requestAccounts" ? "eth_accounts" : method,
            params,
          }),
        }).then((r) => r.json());
        if (r.error) throw Error(r.error.message);
        return r.result;
      },
      on: () => {},
    };
  });
  await p.goto("http://127.0.0.1:13000");
  await p.getByText("Connect MetaMask", { exact: true }).click();
  await p.waitForFunction(() =>
    document.querySelector("#account").textContent.includes("Connected:"),
  );
  await p.locator("#mint").click();
  await p.waitForFunction(() =>
    document.querySelector("#status").textContent.startsWith("Confirmed"),
  );
  await p.locator("#deposit").click();
  await p.waitForFunction(() => !document.querySelector("#deposit").disabled);
  if (!(await p.locator("#status").textContent()).startsWith("Confirmed"))
    throw Error(await p.locator("#status").textContent());
  await p.screenshot({
    path: "evidence/interface-deposit.png",
    fullPage: true,
  });
  await p.locator("#amount").fill("60");
  await p.locator("#deploy").click();
  await p.waitForFunction(() => !document.querySelector("#deploy").disabled);
  await p.locator("#amount").fill("100");
  await p.locator("#request").click();
  await p.waitForFunction(() => !document.querySelector("#request").disabled);
  await fetch("http://127.0.0.1:18545", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "evm_increaseTime",
      params: [700],
    }),
  });
  await fetch("http://127.0.0.1:18545", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "evm_mine",
      params: [],
    }),
  });
  await p.locator("#close").click();
  await p.waitForFunction(() => !document.querySelector("#close").disabled);
  await p.locator("#settle").click();
  await p.waitForFunction(() => !document.querySelector("#settle").disabled);
  if (!(await p.locator("#status").textContent()).startsWith("Confirmed"))
    throw Error(await p.locator("#status").textContent());
  await p.screenshot({
    path: "evidence/interface-partial.png",
    fullPage: true,
  });
  await p.locator("#claim").click();
  await p.waitForFunction(() => !document.querySelector("#claim").disabled);
  const state = await p.request
    .get("http://127.0.0.1:13000/api/state")
    .then((r) => r.json());
  const history = await p.request
    .get("http://127.0.0.1:13000/api/history")
    .then((r) => r.json());
  if (state.principal !== "60000000")
    throw Error("Wrong remaining principal " + state.principal);
  await p.setViewportSize({ width: 390, height: 844 });
  await p.screenshot({ path: "evidence/interface-mobile.png", fullPage: true });
  fs.writeFileSync(
    "evidence/browser-qa.json",
    JSON.stringify(
      {
        wallet: "Injected local EIP-1193 provider; NOT real MetaMask extension",
        chainId: 1337,
        actions: [
          "connect",
          "mint",
          "approve",
          "deposit",
          "deploy fixture",
          "request",
          "close",
          "settle",
          "claim",
        ],
        state,
        eventCount: history.events.length,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  await b.close();
  console.log("Browser and backend integration passed", state);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
