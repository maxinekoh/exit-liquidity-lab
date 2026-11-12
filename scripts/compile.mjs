import fs from "node:fs";
import solc from "solc";
const source = fs.readFileSync("contracts/ExitVault.sol", "utf8");
const output = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: "Solidity",
      sources: { "ExitVault.sol": { content: source } },
      settings: {
        optimizer: { enabled: true, runs: 200 },
        evmVersion: "shanghai",
        outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
      },
    }),
  ),
);
for (const e of output.errors || [])
  if (e.severity === "error") throw Error(e.formattedMessage);
fs.mkdirSync("artifacts", { recursive: true });
for (const [n, c] of Object.entries(output.contracts["ExitVault.sol"]))
  fs.writeFileSync(
    `artifacts/${n}.json`,
    JSON.stringify(
      { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object },
      null,
      2,
    ),
  );
console.log("Compiled with", solc.version());
