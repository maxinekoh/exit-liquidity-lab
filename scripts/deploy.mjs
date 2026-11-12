import fs from "node:fs";
import { JsonRpcProvider, Wallet, ContractFactory } from "ethers";
const p = new JsonRpcProvider(process.env.RPC_URL || "http://127.0.0.1:18545");
const s = process.env.DEPLOYER_KEY
  ? new Wallet(process.env.DEPLOYER_KEY, p)
  : await p.getSigner(0);
const deploy = async (n, args = []) => {
  const a = JSON.parse(fs.readFileSync(`artifacts/${n}.json`));
  const c = await new ContractFactory(a.abi, a.bytecode, s).deploy(...args);
  await c.waitForDeployment();
  return c;
};
const t = await deploy("DemoToken");
const v = await deploy("ExitVault", [
  t.target,
  Number(process.env.ROUND_SECONDS || 120),
]);
const config = {
  chainId: Number((await p.getNetwork()).chainId),
  token: t.target,
  vault: v.target,
  strategy: await v.strategy(),
  startBlock: (await v.deploymentTransaction().wait()).blockNumber,
  manager: await s.getAddress(),
};
fs.writeFileSync("deployment.json", JSON.stringify(config, null, 2));
console.log(config);
