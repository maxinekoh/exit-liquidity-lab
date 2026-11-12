import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { JsonRpcProvider, Contract } from "ethers";
const config = JSON.parse(fs.readFileSync("deployment.json"));
const art = JSON.parse(fs.readFileSync("artifacts/ExitVault.json"));
const provider = new JsonRpcProvider(
  process.env.RPC_URL || "http://127.0.0.1:18545",
  undefined,
  { cacheTimeout: -1 },
);
if (Number((await provider.getNetwork()).chainId) !== config.chainId)
  throw Error("deployment chain mismatch");
if ((await provider.getCode(config.vault)) === "0x")
  throw Error(
    "No deployed vault at configured address; redeploy after resetting chain",
  );
const vault = new Contract(config.vault, art.abi, provider);
const json = (res, data, status = 200) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(
    JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
};
http
  .createServer(async (req, res) => {
    try {
      const u = new URL(req.url, "http://localhost");
      if (req.method !== "GET") return json(res, { error: "GET only" }, 405);
      if (u.pathname === "/api/config")
        return json(res, {
          ...config,
          abi: art.abi,
          tokenAbi: JSON.parse(fs.readFileSync("artifacts/DemoToken.json")).abi,
          strategyAbi: JSON.parse(
            fs.readFileSync("artifacts/LiquidityFixture.json"),
          ).abi,
        });
      if (u.pathname === "/api/state") {
        const block = await provider.getBlockNumber(),
          options = { blockTag: block };
        const id = await vault.currentRound(options),
          r = await vault.rounds(id, options);
        return json(res, {
          round: id,
          closesAt: r.closesAt,
          total: r.total,
          funded: r.funded,
          closed: r.closed,
          free: await vault.freeLiquidity(options),
          reserved: await vault.reserved(options),
          principal: await vault.principal(options),
          block,
        });
      }
      if (u.pathname === "/api/history") {
        const latest = await provider.getBlockNumber();
        const from = Math.max(config.startBlock, latest - 4999);
        const logs = await provider.getLogs({
          address: config.vault,
          fromBlock: from,
          toBlock: latest,
        });
        return json(res, {
          fromBlock: from,
          toBlock: latest,
          limited: from > config.startBlock,
          events: logs
            .map((l) => {
              const e = vault.interface.parseLog(l);
              return {
                event: e.name,
                args: Array.from(e.args),
                hash: l.transactionHash,
                block: l.blockNumber,
              };
            })
            .reverse(),
        });
      }
      let file =
        u.pathname === "/vendor/ethers.js"
          ? "node_modules/ethers/dist/ethers.min.js"
          : path.join("public", u.pathname === "/" ? "index.html" : u.pathname);
      if (
        !path.resolve(file).startsWith(path.resolve("public") + path.sep) &&
        file !== "node_modules/ethers/dist/ethers.min.js"
      ) {
        res.writeHead(403);
        return res.end();
      }
      const types = {
        ".html": "text/html",
        ".css": "text/css",
        ".js": "text/javascript",
      };
      if (!fs.existsSync(file) || !fs.statSync(file).isFile())
        return json(res, { error: "Not found" }, 404);
      const body = fs.readFileSync(file);
      res.writeHead(200, {
        "Content-Type": types[path.extname(file)] || "text/plain",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(body);
    } catch (e) {
      json(res, { error: e.shortMessage || e.message }, 503);
    }
  })
  .listen(Number(process.env.PORT || 3000), "127.0.0.1", () =>
    console.log(
      "Exit Liquidity Lab http://127.0.0.1:" + (process.env.PORT || 3000),
    ),
  );
