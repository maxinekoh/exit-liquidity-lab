import fs from "node:fs";
import assert from "node:assert/strict";
import ganache from "ganache";
import { BrowserProvider, ContractFactory, Contract } from "ethers";
const results = [],
  failures = [],
  gas = {};
let steps = 0,
  reverts = 0,
  assertions = 0;
const art = (n) => JSON.parse(fs.readFileSync(`artifacts/${n}.json`));
const eq = (a, b, label) => {
  assert.equal(a, b, label);
  assertions++;
};
async function world(count = 6) {
  const rpc = ganache.provider({
    logging: { quiet: true },
    chain: { hardfork: "shanghai" },
    wallet: { deterministic: true, totalAccounts: Math.max(40, count) },
  });
  const p = new BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
  const signers = await Promise.all(
    Array.from({ length: count }, (_, i) => p.getSigner(i)),
  );
  const addresses = await Promise.all(signers.map((s) => s.getAddress()));
  const deploy = async (n, args = []) => {
    const a = art(n),
      c = await new ContractFactory(a.abi, a.bytecode, signers[0]).deploy(
        ...args,
      );
    await c.waitForDeployment();
    return c;
  };
  const token = await deploy("DemoToken"),
    vault = await deploy("ExitVault", [token.target, 1000000]);
  const strategy = new Contract(
    await vault.strategy(),
    art("LiquidityFixture").abi,
    signers[0],
  );
  const tx = async (promise) => {
    const t = await promise;
    const r = await rpc.request({
      method: "eth_getTransactionReceipt",
      params: [t.hash],
    });
    return r;
  };
  for (const s of signers) {
    await tx(token.connect(s).mint(1000000000));
    await tx(token.connect(s).approve(vault.target, 1000000000));
  }
  return { rpc, p, signers, addresses, token, vault, strategy, tx };
}
for (const initialSeed of [7619, 42, 99991, 1337, 2026, 8675309]) {
  const w = await world();
  let seed = initialSeed;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  let model = {
    available: Array(6).fill(0n),
    principal: 0n,
    reserved: 0n,
    cash: 0n,
    strategy: 0n,
    donations: 0n,
    round: 1,
    rounds: {
      1: {
        total: 0n,
        funded: 0n,
        closed: false,
        expired: false,
        q: Array(6).fill(0n),
        paid: Array(6).fill(0n),
      },
    },
  };
  const next = () => {
    model.round++;
    model.rounds[model.round] = {
      total: 0n,
      funded: 0n,
      closed: false,
      expired: false,
      q: Array(6).fill(0n),
      paid: Array(6).fill(0n),
    };
  };
  for (let step = 0; step < 80; step++) {
    const op = rnd() % 9,
      user = rnd() % 6,
      a = BigInt(1 + (rnd() % 200)),
      r = model.rounds[model.round];
    let expected = true,
      call,
      effect = () => {},
      name;
    if (op === 0) {
      name = "deposit";
      call = () =>
        w.vault.connect(w.signers[user]).deposit(a, { gasLimit: 500000 });
      effect = () => {
        model.available[user] += a;
        model.principal += a;
        model.cash += a;
      };
    }
    if (op === 1) {
      name = "request";
      expected = !r.closed && !r.expired && model.available[user] >= a;
      call = () =>
        w.vault.connect(w.signers[user]).request(a, { gasLimit: 500000 });
      effect = () => {
        model.available[user] -= a;
        r.q[user] += a;
        r.total += a;
      };
    }
    if (op === 2) {
      name = "deploy";
      expected =
        user === 0 &&
        !r.closed &&
        r.total === 0n &&
        a <= model.cash - model.reserved;
      call = () =>
        w.vault.connect(w.signers[user]).deploy(a, { gasLimit: 500000 });
      effect = () => {
        model.cash -= a;
        model.strategy += a;
      };
    }
    if (op === 3) {
      name = "release";
      expected = user === 0 && a <= model.strategy;
      call = () =>
        w.strategy.connect(w.signers[user]).release(a, { gasLimit: 500000 });
      effect = () => {
        model.strategy -= a;
        model.cash += a;
      };
    }
    if (op === 4) {
      name = "close";
      const expire = Boolean(rnd() % 2);
      if (expire) {
        await w.rpc.request({ method: "evm_increaseTime", params: [1000001] });
        await w.rpc.request({ method: "evm_mine", params: [] });
        r.expired = true;
      }
      expected = !r.closed && r.expired;
      call = () => w.vault.connect(w.signers[user]).close({ gasLimit: 500000 });
      effect = () => {
        r.closed = true;
        if (r.total === 0n) next();
      };
    }
    if (op === 5) {
      name = "settle";
      let n = model.cash - model.reserved;
      if (n > r.total - r.funded) n = r.total - r.funded;
      expected = r.closed && n > 0n;
      call = () =>
        w.vault.connect(w.signers[user]).settle({ gasLimit: 500000 });
      effect = () => {
        r.funded += n;
        model.reserved += n;
        if (r.funded === r.total) next();
      };
    }
    if (op === 6) {
      name = "claim";
      const id = 1 + (rnd() % model.round),
        old = model.rounds[id],
        due = old.total
          ? (old.q[user] * old.funded) / old.total - old.paid[user]
          : 0n;
      expected = due > 0n;
      call = () =>
        w.vault.connect(w.signers[user]).claim(id, { gasLimit: 500000 });
      effect = () => {
        old.paid[user] += due;
        model.reserved -= due;
        model.principal -= due;
        model.cash -= due;
      };
    }
    if (op === 7) {
      name = "donate";
      call = () =>
        w.token
          .connect(w.signers[user])
          .transfer(w.vault.target, a, { gasLimit: 500000 });
      effect = () => {
        model.cash += a;
        model.donations += a;
      };
    }
    if (op === 8) {
      name = "zero deposit";
      expected = false;
      call = () =>
        w.vault.connect(w.signers[user]).deposit(0, { gasLimit: 500000 });
    }
    let receipt = await w.tx(call());
    let success = receipt.status === "0x1";
    eq(success, expected, `seed ${initialSeed} step ${step} ${name}`);
    if (success) {
      effect();
      gas[name] ??= [];
      gas[name].push(parseInt(receipt.gasUsed, 16));
    } else reverts++;
    steps++;
    eq(await w.vault.principal(), model.principal, "principal");
    eq(await w.vault.reserved(), model.reserved, "reserved");
    eq(await w.token.balanceOf(w.vault.target), model.cash, "cash");
    eq(await w.token.balanceOf(w.strategy.target), model.strategy, "strategy");
    eq(await w.vault.currentRound(), BigInt(model.round), "round");
    eq(
      model.cash + model.strategy,
      model.principal + model.donations,
      "conservation including donations",
    );
    assert.ok(model.reserved <= model.cash);
    assertions++;
    for (let i = 0; i < 6; i++)
      eq(
        await w.vault.available(w.addresses[i]),
        model.available[i],
        "available",
      );
    for (const [id, old] of Object.entries(model.rounds)) {
      const actual = await w.vault.rounds(id);
      eq(actual.total, old.total, "round total");
      eq(actual.funded, old.funded, "round funded");
      for (let i = 0; i < 6; i++) {
        const due = old.total
          ? (old.q[i] * old.funded) / old.total - old.paid[i]
          : 0n;
        eq(await w.vault.claimable(id, w.addresses[i]), due, "claimable");
      }
    }
  }
  results.push({ seed: initialSeed, steps: 80, status: "PASS" });
  console.log("state-machine seed passed", initialSeed);
  await w.rpc.disconnect();
}
// Scale and integer-dust scenario: 32 unequal base-unit requests and 17 liquidity installments.
const w = await world(32);
let total = 0n;
for (let i = 0; i < 32; i++) {
  const q = BigInt(i + 1);
  await w.tx(w.vault.connect(w.signers[i]).deposit(q, { gasLimit: 500000 }));
  total += q;
}
await w.tx(w.vault.deploy(total, { gasLimit: 500000 }));
for (let i = 0; i < 32; i++)
  await w.tx(
    w.vault.connect(w.signers[i]).request(BigInt(i + 1), { gasLimit: 500000 }),
  );
await w.rpc.request({ method: "evm_increaseTime", params: [1000001] });
await w.rpc.request({ method: "evm_mine", params: [] });
await w.tx(w.vault.close({ gasLimit: 500000 }));
let funded = 0n;
const settleGas = [];
for (let k = 0; k < 17; k++) {
  const a = k === 16 ? total - funded : 31n;
  await w.tx(w.strategy.release(a, { gasLimit: 500000 }));
  const r = await w.tx(w.vault.settle({ gasLimit: 500000 }));
  eq(r.status, "0x1", "scale settle");
  settleGas.push(parseInt(r.gasUsed, 16));
  funded += a;
  for (let i = 31; i >= 0; i--) {
    const due = await w.vault.claimable(1, w.addresses[i]);
    if (due > 0n) {
      eq(
        (
          await w.tx(
            w.vault.connect(w.signers[i]).claim(1, { gasLimit: 500000 }),
          )
        ).status,
        "0x1",
        "scale claim",
      );
    }
    eq(
      await w.vault.paid(1, w.addresses[i]),
      (BigInt(i + 1) * funded) / total,
      "integer rounding",
    );
  }
  eq(
    (await w.token.balanceOf(w.vault.target)) +
      (await w.token.balanceOf(w.strategy.target)),
    await w.vault.principal(),
    "scale conservation",
  );
}
eq(await w.vault.principal(), 0n, "complete recovery");
eq(await w.vault.reserved(), 0n, "no terminal dust");
eq(await w.vault.MAX_PRINCIPAL(), 10n ** 18n, "cap");
assert.ok((10n ** 18n) ** 2n < 2n ** 256n);
assertions++;
await w.rpc.disconnect();
results.push({
  name: "32 users and 17 liquidity installments",
  status: "PASS",
  settleGas,
});
fs.writeFileSync(
  "evidence/stress.json",
  JSON.stringify(
    {
      environment:
        "Local in-memory EVM; mined success AND revert receipts; independent state-machine oracle; not public-network stress",
      steps,
      reverts,
      assertions,
      seeds: results,
      gasByOperation: Object.fromEntries(
        Object.entries(gas).map(([k, v]) => [
          k,
          { min: Math.min(...v), max: Math.max(...v), samples: v.length },
        ]),
      ),
      limitations: [
        "No real lending integration",
        "No actual MetaMask extension",
        "No formal verification",
        "No arbitrary-token support",
        "Random actions are seeded and bounded",
      ],
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    steps,
    reverts,
    assertions,
    scalingUsers: 32,
    installments: 17,
  }),
);
