import fs from "node:fs";
import assert from "node:assert/strict";
export function simulate(requests, returns, order, proportional = false) {
  const q = requests.map(BigInt),
    Q = q.reduce((a, b) => a + b, 0n),
    paid = q.map(() => 0n),
    first = q.map(() => null),
    done = q.map(() => null),
    timeline = [];
  let cash = 0n,
    F = 0n,
    received = 0n;
  for (let t = 0; t < returns.length; t++) {
    cash += BigInt(returns[t]);
    received += BigInt(returns[t]);
    if (proportional && Q) {
      const reserved = F - paid.reduce((a, b) => a + b, 0n),
        free = cash - reserved,
        n = free < Q - F ? free : Q - F;
      F += n;
      for (let i = 0; i < q.length; i++) {
        const due = (q[i] * F) / Q - paid[i];
        paid[i] += due;
        cash -= due;
      }
    } else if (!proportional) {
      for (const i of order) {
        const due = q[i] - paid[i],
          take = cash < due ? cash : due;
        paid[i] += take;
        cash -= take;
      }
    }
    for (let i = 0; i < q.length; i++) {
      assert.ok(paid[i] >= 0n && paid[i] <= q[i]);
      if (paid[i] > 0n && first[i] === null) first[i] = t + 1;
      if (paid[i] === q[i] && done[i] === null) done[i] = t + 1;
    }
    assert.equal(cash + paid.reduce((a, b) => a + b, 0n), received);
    timeline.push(
      paid.map((v, i) => (q[i] ? Number((v * 1000000n) / q[i]) / 10000 : 100)),
    );
  }
  return {
    fulfilledPercentByCheckpoint: timeline,
    firstPaymentCheckpoint: first,
    completionCheckpoint: done,
    residualCash: cash.toString(),
    totalPaid: paid.reduce((a, b) => a + b, 0n).toString(),
  };
}
const requests = [100000000n, 150000000n, 250000000n],
  liquidity = [200000000n, 100000000n, 200000000n];
const outputs = [
  { policy: "sequential", ...simulate(requests, liquidity, [2, 1, 0]) },
  { policy: "FIFO", ...simulate(requests, liquidity, [0, 1, 2]) },
  {
    policy: "proportional cohort",
    ...simulate(requests, liquidity, [0, 1, 2], true),
  },
];
const permutations = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];
let seed = 7619,
  cases = 0;
const rnd = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed;
};
for (let k = 0; k < 50; k++) {
  const q = [
      1n + BigInt(rnd() % 900),
      1n + BigInt(rnd() % 900),
      1n + BigInt(rnd() % 900),
    ],
    Q = q.reduce((a, b) => a + b, 0n),
    a = Q / 4n;
  for (const path of [
    [0n, a, a, Q - 2n * a, 17n],
    [0n, 0n, 0n],
    [Q + 11n, 0n, 0n],
  ]) {
    const ref = simulate(q, path, [0, 1, 2], true);
    for (const order of permutations) {
      const prop = simulate(q, path, order, true);
      assert.deepEqual(prop, ref);
      simulate(q, path, order);
      cases++;
    }
  }
}
simulate([0n, 0n, 0n], [0n, 1n, 0n], [0, 1, 2], true);
cases++;
fs.writeFileSync(
  "evidence/benchmark.json",
  JSON.stringify(
    {
      label:
        "Synthetic single-cohort model with integer base units and cumulative rounding; not historical replay. Immediate withdrawals use reverse order; FIFO uses arrival order. Baselines permit partial withdrawals and assume prompt claims. No strategic arrival response or cross-cohort arrivals modeled.",
      requests: requests.map(String),
      liquidity: liquidity.map(String),
      outputs,
      robustness: {
        seed: 7619,
        scenarioPermutationPairs: cases,
        checks:
          "Conservation, bounded fulfillment, zero demand, over-return, no-return, integer dust, and proportional within-cohort order invariance",
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ outputs, scenarioPermutationPairs: cases }, null, 2),
);
