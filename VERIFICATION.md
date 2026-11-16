# Verification notes

The vault tests check that claims stay within funded amounts, that paid amounts cannot be claimed again, and that outstanding principal reconciles with the vault and fixture balances. The [regression run](evidence/tests.json) records 34 checks. The [stress run](evidence/stress.json) records 480 actions across six reproducible seeds and a separate 32-user case spanning 17 funding installments.

The [browser run](evidence/browser-qa.json) goes from a 100 dUSD deposit to a 40 dUSD partial claim, leaving 60 dUSD outstanding. It uses an injected wallet and a local chain. The [HTTP and wallet checks](evidence/http-wallet-errors.json) cover API responses and simulated wallet errors. The benchmark uses synthetic liquidity returns.

The contract supports the fixed demo token. The aggregate principal cap bounds the multiplication used in proportional allocation. Closed rounds can delay later requests indefinitely if the fixture manager withholds funds. The prototype uses local test assets and has had no independent security audit.

The recorded [full dependency audit](evidence/npm-audit-all.json) lists 33 advisories, including five critical, in Ganache's development dependency tree. Keep the local chain on loopback and use disposable test accounts. The [runtime tree](evidence/runtime-tree.txt) and [clean-install record](evidence/clean-install.json) are included separately.
