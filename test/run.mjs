import fs from "node:fs";
import solc from "solc";
import assert from "node:assert/strict";
import ganache from "ganache";
import { BrowserProvider, ContractFactory, Contract } from "ethers";
const rpc = ganache.provider({
  logging: { quiet: true },
  chain: { hardfork: "shanghai" },
  wallet: { deterministic: true },
});
const p = new BrowserProvider(rpc);
p.pollingInterval = 10;
const s = await Promise.all([0, 1, 2, 3].map((i) => p.getSigner(i)));
const addr = await Promise.all(s.map((x) => x.getAddress()));
let token, vault, strategy;
const results = [];
const gas = {};
const art = (n) => JSON.parse(fs.readFileSync(`artifacts/${n}.json`));
async function deploy(n, args = []) {
  const a = art(n),
    c = await new ContractFactory(a.abi, a.bytecode, s[0]).deploy(...args);
  await c.waitForDeployment();
  return c;
}
async function send(name, promise) {
  const r = await (await promise).wait();
  gas[name] = Number(r.gasUsed);
  return r;
}
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, status: "PASS" });
  } catch (e) {
    results.push({ name, status: "FAIL", error: e.shortMessage || e.message });
    throw e;
  }
}
const reject = async (fn) => assert.rejects(fn);
const units = (n) => BigInt(n) * 1000000n;
async function setup(amounts = [100, 150, 250]) {
  token = await deploy("DemoToken");
  vault = await deploy("ExitVault", [token.target, 20]);
  strategy = new Contract(
    await vault.strategy(),
    art("LiquidityFixture").abi,
    s[0],
  );
  for (let i = 0; i < amounts.length; i++) {
    const a = units(amounts[i]);
    await send("mint", token.connect(s[i]).mint(a));
    await send("approve", token.connect(s[i]).approve(vault.target, a));
    await send("deposit", vault.connect(s[i]).deposit(a));
  }
}
async function advance() {
  await rpc.request({ method: "evm_increaseTime", params: [25] });
  await rpc.request({ method: "evm_mine", params: [] });
}
await setup();
await check("deployment and token configuration", async () => {
  assert.equal(await vault.asset(), token.target);
  assert.equal(await token.decimals(), 6n);
});
await check("deposits credit principal", async () =>
  assert.equal(await vault.principal(), units(500)),
);
await check("zero deposit rejected", () =>
  reject(() => vault.deposit.staticCall(0)),
);
await check("deposit without allowance rejected", () =>
  reject(() => vault.connect(s[3]).deposit.staticCall(1)),
);
await check("unauthorized strategy deployment rejected", () =>
  reject(() => vault.connect(s[1]).deploy.staticCall(1)),
);
await check("early close rejected", () =>
  reject(() => vault.close.staticCall()),
);
await send("deploy", vault.deploy(units(300)));
for (let i = 0; i < 3; i++)
  await send("request", vault.connect(s[i]).request(units([100, 150, 250][i])));
await check("request removes spendable entitlement", async () =>
  assert.equal(await vault.available(addr[0]), 0n),
);
await check("duplicate principal request rejected", () =>
  reject(() => vault.request.staticCall(1)),
);
await check("deployment with requests pending rejected", () =>
  reject(() => vault.deploy.staticCall(1)),
);
await check("settlement before close rejected", () =>
  reject(() => vault.settle.staticCall()),
);
await advance();
await send("close", vault.close({ gasLimit: 300000 }));
await send("settle", vault.settle());
await check("40 percent proportional allocation", async () => {
  for (let i = 0; i < 3; i++)
    assert.equal(await vault.claimable(1, addr[i]), units([40, 60, 100][i]));
});
await check("reserved funds match funded total", async () =>
  assert.equal(await vault.reserved(), units(200)),
);
await check("cannot overfund using reserved liquidity", () =>
  reject(() => vault.settle.staticCall()),
);
await check("new requests blocked in closed cohort", () =>
  reject(() => vault.connect(s[3]).request.staticCall(1)),
);
await check("unrelated wallet cannot claim others entitlement", () =>
  reject(() => vault.connect(s[3]).claim.staticCall(1)),
);
for (let i = 0; i < 3; i++) await send("claim", vault.connect(s[i]).claim(1));
await check("duplicate claim rejected", () =>
  reject(() => vault.claim.staticCall(1)),
);
await check("partial claims preserve remaining principal", async () =>
  assert.equal(await vault.principal(), units(300)),
);
await check("unauthorized fixture release rejected", () =>
  reject(() => strategy.connect(s[1]).release.staticCall(1)),
);
await send("release", strategy.release(units(300)));
await send("settle", vault.settle({ gasLimit: 300000 }));
await check("fully funded cohort opens next round", async () =>
  assert.equal(await vault.currentRound(), 2n),
);
await check("reserved claims cannot be redeployed", () =>
  reject(() => vault.deploy.staticCall(1)),
);
for (let i = 0; i < 3; i++)
  await send("claim", vault.connect(s[i]).claim(1, { gasLimit: 300000 }));
await check("all principal returned without residual reservation", async () => {
  assert.equal(await vault.reserved(), 0n);
  assert.equal(await vault.principal(), 0n);
  for (let i = 0; i < 3; i++)
    assert.equal(await token.balanceOf(addr[i]), units([100, 150, 250][i]));
});
await advance();
await send("close empty", vault.close({ gasLimit: 300000 }));
await check("empty expired round can advance", async () =>
  assert.equal(await vault.currentRound(), 3n),
);
// Seeded scenario tests: varying request sizes, partial funding and claim ordering.
let seed = 7619;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed;
};
for (let run = 0; run < 6; run++) {
  const a = [1 + (rnd() % 900), 1 + (rnd() % 900), 1 + (rnd() % 900)];
  await setup(a);
  const total = a.reduce((x, y) => x + y, 0);
  await send("deploy", vault.deploy(units(total)));
  for (let i = 0; i < 3; i++)
    await send("request", vault.connect(s[i]).request(units(a[i])));
  await advance();
  await send("close", vault.close({ gasLimit: 300000 }));
  const first = units(Math.max(1, Math.floor(total * 0.37)));
  await send("release", strategy.release(first));
  await send("settle", vault.settle());
  for (const i of [2, 0, 1]) await send("claim", vault.connect(s[i]).claim(1));
  await check(
    `seeded conservation and proportional allocation ${run + 1}`,
    async () => {
      assert.ok(
        (await vault.reserved()) <= (await token.balanceOf(vault.target)),
      );
      assert.equal(
        (await token.balanceOf(vault.target)) +
          (await token.balanceOf(strategy.target)),
        await vault.principal(),
      );
      for (let i = 0; i < 3; i++)
        assert.equal(
          await vault.paid(1, addr[i]),
          (units(a[i]) * first) / units(total),
        );
    },
  );
  await send("release", strategy.release(units(total) - first));
  await send("settle", vault.settle({ gasLimit: 300000 }));
  for (let i = 0; i < 3; i++)
    await send("claim", vault.connect(s[i]).claim(1, { gasLimit: 300000 }));
  await check(`full recovery including rounding ${run + 1}`, async () => {
    assert.equal(await vault.principal(), 0n);
    assert.equal(await vault.reserved(), 0n);
  });
}
fs.mkdirSync("evidence", { recursive: true });
fs.writeFileSync(
  "evidence/tests.json",
  JSON.stringify(
    {
      environment:
        `Ganache in-memory EVM; Shanghai; solc ${solc.version()}; optimizer 200; not Sepolia`,
      passed: results.length,
      results,
      gasLastObserved: gas,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ passed: results.length, gasLastObserved: gas }, null, 2),
);
await rpc.disconnect();
