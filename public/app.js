import {
  BrowserProvider,
  Contract,
  formatUnits,
  parseUnits,
} from "/vendor/ethers.js";
const $ = (id) => document.getElementById(id),
  fmt = (v) => formatUnits(v, 6);
const cfg = await fetch("/api/config").then((r) => r.json());
let provider,
  signer,
  vault,
  token,
  fixture,
  busy = false;
const message = (t) => ($("status").textContent = t);
async function refresh() {
  const state = await fetch("/api/state").then((r) => r.json());
  if (state.error) throw Error(state.error);
  $("metrics").innerHTML = [
    ["Outstanding principal including claims", fmt(state.principal)],
    ["Immediately unreserved liquidity", fmt(state.free)],
    ["Reserved for funded claims", fmt(state.reserved)],
    ["Current round", state.round],
  ]
    .map(
      ([n, v]) =>
        `<article class="metric"><small>${n}</small><strong>${v}</strong></article>`,
    )
    .join("");
  $("roundDetail").textContent =
    `Round ${state.round}: ${state.closed ? "Closed; awaiting liquidity" : "Open until " + new Date(Number(state.closesAt) * 1000).toLocaleString()}. Requested ${fmt(state.total)}; funded ${fmt(state.funded)} dUSD.`;
  if (signer) {
    const a = await signer.getAddress(),
      id = BigInt($("claimRound").value || 1);
    $("wallet").textContent = fmt(await token.balanceOf(a));
    $("available").textContent = fmt(await vault.available(a));
    $("requested").textContent = fmt(await vault.requests(id, a));
    $("paid").textContent = fmt(await vault.paid(id, a));
    const q = await vault.requests(id, a),
      paid = await vault.paid(id, a),
      claimable = await vault.claimable(id, a);
    $("claimable").textContent = fmt(claimable);
    $("pending").textContent = fmt(q - paid - claimable);
  }
  const h = await fetch("/api/history").then((r) => r.json());
  if (h.error) throw Error(h.error);
  $("range").textContent =
    `Confirmed event scan: blocks ${h.fromBlock}–${h.toBlock}${h.limited ? " (bounded history; older events omitted)" : ""}.`;
  $("history").replaceChildren(
    ...h.events.slice(0, 30).map((e) => {
      const tr = document.createElement("tr");
      for (const x of [e.event, e.block, e.hash]) {
        const td = document.createElement("td");
        td.textContent = x;
        tr.append(td);
      }
      return tr;
    }),
  );
}
async function tx(call) {
  const t = await call();
  message("Submitted; awaiting receipt: " + t.hash);
  const r = await t.wait();
  if (r.status !== 1) throw Error("Transaction reverted");
  message("Confirmed in block " + r.blockNumber + ": " + t.hash);
  await refresh();
}
async function action(fn) {
  if (busy) return;
  busy = true;
  document.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    if (!signer) throw Error("Connect MetaMask first.");
    await fn();
  } catch (e) {
    message("Action not completed: " + (e.shortMessage || e.message));
  } finally {
    busy = false;
    document.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
}
$("connect").onclick = async () => {
  try {
    if (!window.ethereum) throw Error("MetaMask is not installed.");
    provider = new BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    if (Number((await provider.getNetwork()).chainId) !== cfg.chainId)
      throw Error(`Wrong network. Select chain ${cfg.chainId} in MetaMask.`);
    signer = await provider.getSigner();
    vault = new Contract(cfg.vault, cfg.abi, signer);
    token = new Contract(cfg.token, cfg.tokenAbi, signer);
    fixture = new Contract(cfg.strategy, cfg.strategyAbi, signer);
    $("connect").textContent = "Wallet connected";
    $("account").textContent =
      "Connected: " + (await signer.getAddress()) + " · chain " + cfg.chainId;
    message("Connected. Review the test-token notice before transacting.");
    await refresh();
  } catch (e) {
    message(e.message);
  }
};
const amount = () => parseUnits($("amount").value, 6);
$("mint").onclick = () => action(() => tx(() => token.mint(amount())));
$("deposit").onclick = () =>
  action(async () => {
    const a = amount();
    await tx(() => token.approve(cfg.vault, a));
    message("Approval confirmed. Awaiting deposit signature.");
    await tx(() => vault.deposit(a));
  });
$("request").onclick = () => action(() => tx(() => vault.request(amount())));
$("claim").onclick = () =>
  action(() => tx(() => vault.claim(BigInt($("claimRound").value))));
$("close").onclick = () => action(() => tx(() => vault.close()));
$("settle").onclick = () => action(() => tx(() => vault.settle()));
$("deploy").onclick = () => action(() => tx(() => vault.deploy(amount())));
$("release").onclick = () => action(() => tx(() => fixture.release(amount())));
$("claimRound").onchange = () => refresh().catch((e) => message(e.message));
if (window.ethereum) {
  for (const e of ["accountsChanged", "chainChanged"])
    window.ethereum.on(e, () => location.reload());
}
await refresh().catch((e) => message(e.message));
setInterval(() => {
  if (!busy) refresh().catch((e) => message(e.message));
}, 10000);
