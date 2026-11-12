# Exit Liquidity Lab

Repository: https://github.com/maxinekoh/exit-liquidity-lab (private). This is an educational prototype, not a production vault. See AUDIT_FINDINGS.txt for the technical and academic review and SUBMISSION_GUIDE.txt for hand-in instructions.


SC6106 individual assignment first draft. A principal-only financial DApp for proportional asynchronous withdrawals. Test assets only; no production funds, actual yield, ERC-4626/7540 compliance or independent audit is claimed.

## Reproduce locally

Use Node.js 22 or 24 and npm. From this directory:

```sh
npm ci
npm run compile
npm run check:all
```

Open three terminals in this directory:

```sh
# Terminal 1: deterministic LOCAL test accounts only
npm run chain
```

```sh
# Terminal 2: creates deployment.json for this chain
npm run deploy
# Start server after deployment
npm start
```

Open http://127.0.0.1:3000 in a browser with MetaMask. Add the LOCAL network RPC http://127.0.0.1:18545, chain ID 1337, currency ETH. Use only disposable local Ganache test accounts, never existing real-money keys. Ganache prints its public deterministic test keys; import an account into a separate test wallet if needed. These keys are publicly known and are not suitable for any public network.

The first deployer is the fixture manager. Other users may deposit, request and claim; anyone may close an eligible round and settle actual available liquidity. The server never signs transactions or asks for private keys. A database is unnecessary: contract events reconstruct confirmed history. API scans the last 5,000 blocks and labels truncation; it is not a production indexer.

Defaults: RPC_URL=http://127.0.0.1:18545, PORT=3000, ROUND_SECONDS=120. Override via shell environment. Restart or redeploy if the local chain is reset. Deployment addresses in the evidence are local and will not identify contracts on Sepolia.

## Demonstration

1. Connect MetaMask. Get 100 test dUSD; approve and deposit 100.
2. Before requests exist, manager moves 60 to the fixture.
3. Request 100 in the open round. Wait for its close timestamp.
4. Close the round and settle. Of the 100 requested, 40 is claimable.
5. Claim 40. Remaining principal is 60; a repeated claim fails.
6. Manager returns 60 from the fixture; settle again, then claim the rest.
7. The next round opens on full funding, independently of claim timing.

For three-wallet proportional behavior deposit/request 100, 150 and 250; move 300 of the combined 500 to the fixture before any requests. Initial 200 liquidity allocates 40, 60 and 100. All participants in that closed round retain their original proportions on cumulative funding. No later cohort opens until this cohort is fully funded. Empty expired rounds can be advanced by anyone.

## Design and files

- contracts/ExitVault.sol: vault, conventional six-decimal demo token, delayed-liquidity fixture.
- scripts/compile.mjs and deploy.mjs: compiler and deployment.
- public/: responsive HTML/CSS/JS and MetaMask EIP-1193 connector.
- server.mjs: Node.js read-only configuration, state and confirmed-event APIs.
- test/run.mjs: 34 regression checks. test/stress.mjs adds 480 state-machine actions, 339 mined reverts, 17,613 assertions and a 32-user/17-installment case.
- scripts/benchmark.mjs: synthetic policy comparison; not historical replay.
- evidence/: machine-readable results and actual local interface screenshots.
- report.pdf and report-source.txt: eight-page report and editable plain-text narrative.

No private deployment key is bundled. deployment.json is a public local configuration, not a credential. node_modules is excluded from the distributable ZIP; npm ci restores dependencies from package-lock.json.

## Security and economic boundaries

Only the fixed test token is supported. The faucet is deliberately unrestricted; it has no monetary value. Exact balance-delta checking rejects fee-taking deposits, but does not make arbitrary token behavior safe. There is no rescue function, proxy, strategy selection, performance fee, interest or loss recognition. The manager can delay returns indefinitely, but the fixture can transfer only to the vault. Pending requests cannot be cancelled in this version. New deposits do not confer priority; they may provide cash to existing requests while retaining their own principal claim. This is liquidity substitution, not new wealth.

Depositor requests remain in a closed cohort until fully funded; later depositors can be temporarily or indefinitely blocked from requesting. No fixed completion date is promised. Fully funded claims remain reserved and cannot be redeployed. Direct token donations are excess assets and not credited as principal. Proportional integer division can leave temporary dust; full funding makes each original requested amount exactly payable. MAX_PRINCIPAL caps outstanding principal at 10^18 base units (10^12 dUSD). Since q and F are each bounded by it, their product fits uint256. No full-precision mulDiv library is required under this bound.

## Verification status

Verified: compilation; in-memory local deployment; 34 regression checks; expanded state-machine and scale tests; 901 synthetic model scenario/permutation pairs; browser workflow and backend with a local injected EIP-1193 provider. The browser harness is NOT the MetaMask extension. Responsive screenshots are real application captures. The controlled strategy simulates delayed liquidity.

Outstanding: actual MetaMask-extension acceptance testing, Sepolia deployment and public explorer evidence, human usability evaluation, large randomized adversarial campaigns, malicious-token testing, real protocol adapter, loss/yield accounting and independent security review. See SUBMISSION_REVIEW.md. No grade or production-safety guarantee is implied.

## Sepolia deployment path

Use a dedicated funded testnet deployer and a trusted Sepolia RPC endpoint. Set RPC_URL, DEPLOYER_KEY and ROUND_SECONDS in the process environment; do not commit keys or include them in screenshots. Run npm run compile then npm run deploy. DEPLOYER_KEY is required on public RPC endpoints that do not expose unlocked signers. Restart the backend with that RPC_URL. deployment.json supplies chain ID 11155111 to the frontend. Add Sepolia in MetaMask, execute the full workflow, and record contract address, deployment hash and explorer receipts in evidence before claiming Sepolia verification. Script support does not establish successful deployment.

## Optional browser and report tools

The portable browser harness requires Playwright and installed Google Chrome. In a disposable checkout, install Playwright separately, start a fresh local deployment with ROUND_SECONDS=600 and backend PORT=13000, then run `node test/browser-qa.cjs`. It injects local unlocked test accounts and advances local EVM time; never point it at public networks. Screenshot output is under evidence/. Actual MetaMask acceptance still needs manual testing.

To rebuild the PDF after editing the narrative in scripts/create_report.py, install requirements-report.txt into a Python environment and run that script. report-source.txt is an exported text version; changing it alone does not rebuild the PDF.

## Dependency review

Runtime ethers is pinned to 6.17.0. Solidity compiler 0.8.38 uses a targeted tmp 0.2.7 override. Ganache, solc and formatters are development dependencies. Final full-tree npm audit records 33 advisories (five critical) in Ganache's bundled development subtree. They remain unresolved: restricting use to disposable, localhost test environments reduces exposure but does not fix them. Do not report this toolchain as vulnerability-free. npm's omit-dev audit still reports bundled entries; use the recorded installed runtime tree to distinguish actual runtime packages. A future production setup should replace this legacy chain tooling.

For runtime-only installations after compilation and deployment, `npm ci --omit=dev` excludes the local chain and compiler. Keep generated artifacts and deployment configuration; they are intentionally ignored by Git.
