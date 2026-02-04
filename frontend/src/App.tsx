import { useEffect, useMemo, useState } from 'react';
import './index.css';
import { ADDRS, CHAIN_ID, EXPLORER } from './claave/constants';
import { ACL_ABI, ACLPOOL_ABI, ERC20_ABI, STAKING_ABI, STRATEGYMOCK_ABI } from './claave/abi';
import { contractRead, contractWrite, ensureMonadChain, getInjectedProvider, getReadonlyProvider } from './claave/eth';
import { formatUnits, parseUnits, ZeroAddress } from 'ethers';

function short(a: string) {
  return a.slice(0, 6) + '…' + a.slice(-4);
}

function bnToStr(v: any, decimals: number) {
  try {
    return formatUnits(v, decimals);
  } catch {
    return String(v);
  }
}

export default function App() {
  const ro = useMemo(() => getReadonlyProvider(), []);
  const [account, setAccount] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('disconnected');
  const [refresh, setRefresh] = useState<number>(0);

  // read state
  const [usdcDecimals, setUsdcDecimals] = useState<number>(6);
  const [poolAssets, setPoolAssets] = useState<string>('—');
  const [poolLiquidity, setPoolLiquidity] = useState<string>('—');

  const [bond, setBond] = useState<string>('—');
  const [debt, setDebt] = useState<string>('—');
  const [score, setScore] = useState<string>('—');
  const [failures, setFailures] = useState<string>('—');
  const [frozen, setFrozen] = useState<string>('—');
  const [strategy, setStrategy] = useState<string>('—');
  const [equity, setEquity] = useState<string>('—');

  const [creditLimit, setCreditLimit] = useState<string>('—');
  const [available, setAvailable] = useState<string>('—');

  // inputs
  const [depositAmt, setDepositAmt] = useState('100');
  const [bondAmt, setBondAmt] = useState('50');
  const [borrowAmt, setBorrowAmt] = useState('10');
  const [repayAmt, setRepayAmt] = useState('10');
  const [pnl, setPnl] = useState('1');

  const [kclDecimals, setKclDecimals] = useState<number>(18);
  const [kclStaked, setKclStaked] = useState<string>('—');
  const [kclStakeAmt, setKclStakeAmt] = useState('100000');

  async function connect() {
    const ip = getInjectedProvider();
    if (!ip) {
      alert('No injected wallet found');
      return;
    }
    setStatus('connecting…');
    await ip.send('eth_requestAccounts', []);
    await ensureMonadChain(ip);
    const signer = await ip.getSigner();
    const addr = await signer.getAddress();
    setAccount(addr);
    setStatus('connected');
    setRefresh((x) => x + 1);
  }

  async function load() {
    const usdc = contractRead(ADDRS.mUSDC, ERC20_ABI, ro);
    const dec = await usdc.decimals();
    setUsdcDecimals(Number(dec));

    const pool = contractRead(ADDRS.pool, ACLPOOL_ABI, ro);
    const ta = await pool.totalAssets();
    const liq = await pool.availableLiquidity();
    setPoolAssets(bnToStr(ta, Number(dec)));
    setPoolLiquidity(bnToStr(liq, Number(dec)));

    const acl = contractRead(ADDRS.acl, ACL_ABI, ro);
    const st = await acl.state();
    const [, strat, bondV, debtV, scoreV, failuresV, frozenV] = st;

    // KCL staking state
    const kcl = contractRead(ADDRS.tokenKCL, ERC20_ABI, ro);
    const kclDec = await kcl.decimals();
    setKclDecimals(Number(kclDec));
    const staking = contractRead(ADDRS.staking, STAKING_ABI, ro);
    const staked = account ? await staking.staked(account) : 0n;
    setKclStaked(bnToStr(staked, Number(kclDec)));

    setBond(bnToStr(bondV, Number(dec)));
    setDebt(bnToStr(debtV, Number(dec)));
    setScore(scoreV.toString());
    setFailures(failuresV.toString());
    setFrozen(String(frozenV));
    setStrategy(strat === ZeroAddress ? '—' : strat);

    // equity: read strategy balance directly
    const eq = await usdc.balanceOf(strat);
    setEquity(bnToStr(eq, Number(dec)));

    const lim = await acl.creditLimit();
    const avail = await acl.availableToBorrow();
    setCreditLimit(bnToStr(lim, Number(dec)));
    setAvailable(bnToStr(avail, Number(dec)));
  }

  useEffect(() => {
    load().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  // actions
  async function lenderDeposit() {
    if (!account) return;
    const ip = getInjectedProvider();
    if (!ip) return;
    await ensureMonadChain(ip);
    const signer = await ip.getSigner();

    const usdc = contractWrite(ADDRS.mUSDC, ERC20_ABI, signer);
    const pool = contractWrite(ADDRS.pool, ACLPOOL_ABI, signer);

    const amt = parseUnits(depositAmt, usdcDecimals);
    const allowance = await usdc.allowance(account, ADDRS.pool);
    if (allowance < amt) {
      const txa = await usdc.approve(ADDRS.pool, amt);
      await txa.wait();
    }
    const tx = await pool.deposit(amt, account);
    await tx.wait();
    setRefresh((x) => x + 1);
  }

  async function borrowerPostBond() {
    if (!account) return;
    const ip = getInjectedProvider();
    if (!ip) return;
    await ensureMonadChain(ip);
    const signer = await ip.getSigner();

    const usdc = contractWrite(ADDRS.mUSDC, ERC20_ABI, signer);
    const acl = contractWrite(ADDRS.acl, ACL_ABI, signer);

    const amt = parseUnits(bondAmt, usdcDecimals);
    const allowance = await usdc.allowance(account, ADDRS.acl);
    if (allowance < amt) {
      const txa = await usdc.approve(ADDRS.acl, amt);
      await txa.wait();
    }
    const tx = await acl.postBond(amt);
    await tx.wait();
    setRefresh((x) => x + 1);
  }

  async function borrowerLinkStrategy() {
    if (!account) return;
    const ip = getInjectedProvider();
    if (!ip) return;
    await ensureMonadChain(ip);
    const signer = await ip.getSigner();

    const acl = contractWrite(ADDRS.acl, ACL_ABI, signer);

    // Signature scheme: digest = keccak256("ACL_LINK", acl, borrower, strategy)
    // We'll use the deployed StrategyMock as the strategy address.
    const strategyAddr = ADDRS.strategyMock;

    // match solidity: keccak256(abi.encodePacked("ACL_LINK", address(this), msg.sender, strategy));
    // Compute locally using ethers.solidityPackedKeccak256
    const { solidityPackedKeccak256 } = await import('ethers');
    const raw = solidityPackedKeccak256(
      ['string', 'address', 'address', 'address'],
      ['ACL_LINK', ADDRS.acl, account, strategyAddr]
    );
    const sig = await signer.signMessage(raw);

    const tx = await acl.linkStrategy(strategyAddr, sig);
    await tx.wait();
    setRefresh((x) => x + 1);
  }

  async function borrowerBorrow() {
    if (!account) return;
    const ip = getInjectedProvider();
    if (!ip) return;
    await ensureMonadChain(ip);
    const signer = await ip.getSigner();
    const acl = contractWrite(ADDRS.acl, ACL_ABI, signer);

    const amt = parseUnits(borrowAmt, usdcDecimals);
    const tx = await acl.borrow(amt);
    await tx.wait();
    setRefresh((x) => x + 1);
  }

  async function borrowerRepay() {
    if (!account) return;
    const ip = getInjectedProvider();
    if (!ip) return;
    await ensureMonadChain(ip);
    const signer = await ip.getSigner();

    const usdc = contractWrite(ADDRS.mUSDC, ERC20_ABI, signer);
    const acl = contractWrite(ADDRS.acl, ACL_ABI, signer);

    const amt = parseUnits(repayAmt, usdcDecimals);
    const allowance = await usdc.allowance(account, ADDRS.acl);
    if (allowance < amt) {
      const txa = await usdc.approve(ADDRS.acl, amt);
      await txa.wait();
    }

    const tx = await acl.repay(amt);
    await tx.wait();
    setRefresh((x) => x + 1);
  }

  async function strategySimulatePnL() {
    if (!account) return;
    const ip = getInjectedProvider();
    if (!ip) return;
    await ensureMonadChain(ip);
    const signer = await ip.getSigner();

    const strat = contractWrite(ADDRS.strategyMock, STRATEGYMOCK_ABI, signer);
    // pnl is in token units (mUSDC has 6 decimals)
    const scaled = parseUnits(pnl, usdcDecimals);
    const tx = await strat.simulatePnL(scaled);
    await tx.wait();
    setRefresh((x) => x + 1);
  }

  async function keeperUpdateEpoch() {
    const ip = getInjectedProvider();
    if (!ip) {
      alert('Keeper requires an injected wallet to pay gas (for now).');
      return;
    }
    await ensureMonadChain(ip);
    const signer = await ip.getSigner();
    const acl = contractWrite(ADDRS.acl, ACL_ABI, signer);
    const tx = await acl.updateEpoch();
    await tx.wait();
    setRefresh((x) => x + 1);
  }

  async function stakeKCL() {
    if (!account) return;
    const ip = getInjectedProvider();
    if (!ip) return;
    await ensureMonadChain(ip);
    const signer = await ip.getSigner();

    const kcl = contractWrite(ADDRS.tokenKCL, ERC20_ABI, signer);
    const staking = contractWrite(ADDRS.staking, STAKING_ABI, signer);

    const amt = parseUnits(kclStakeAmt, kclDecimals);
    const allowance = await kcl.allowance(account, ADDRS.staking);
    if (allowance < amt) {
      const txa = await kcl.approve(ADDRS.staking, amt);
      await txa.wait();
    }
    const tx = await staking.stake(amt);
    await tx.wait();
    setRefresh((x) => x + 1);
  }

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>KLAAVE</div>
          <div style={{ opacity: 0.75 }}>Agent-native credit lines on Monad</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'monospace' }}>{account ? short(account) : '—'}</div>
          <button onClick={connect} style={{ marginTop: 8 }}>{account ? 'Connected' : 'Connect Wallet'}</button>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>{status} • chain {CHAIN_ID}</div>
        </div>
      </header>

      <section style={{ marginTop: 24, padding: 16, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <a href={EXPLORER.address(ADDRS.acl)} target="_blank" rel="noreferrer">ACL Contract</a>
          <a href={EXPLORER.address(ADDRS.pool)} target="_blank" rel="noreferrer">Pool</a>
          <a href={EXPLORER.address(ADDRS.mUSDC)} target="_blank" rel="noreferrer">mUSDC</a>
          <a href={EXPLORER.nadToken(ADDRS.tokenKCL)} target="_blank" rel="noreferrer">KCL on nad.fun</a>
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <section style={{ padding: 16, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12 }}>
          <h3>Lender</h3>
          <div>Pool assets: <b>{poolAssets}</b> mUSDC</div>
          <div>Available liquidity: <b>{poolLiquidity}</b> mUSDC</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input value={depositAmt} onChange={(e) => setDepositAmt(e.target.value)} style={{ flex: 1 }} />
            <button onClick={lenderDeposit}>Deposit</button>
          </div>
        </section>

        <section style={{ padding: 16, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12 }}>
          <h3>Borrower</h3>
          <div>Strategy: <b>{strategy === '—' ? '—' : short(strategy)}</b></div>
          <div>Equity: <b>{equity}</b> mUSDC</div>
          <div>Bond: <b>{bond}</b> mUSDC</div>
          <div>Debt: <b>{debt}</b> mUSDC</div>
          <div>Score: <b>{score}</b> | failures: <b>{failures}</b> | frozen: <b>{frozen}</b></div>
          <div>Credit limit: <b>{creditLimit}</b> | available: <b>{available}</b></div>

          <div style={{ marginTop: 12, padding: 12, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }}>
            <div style={{ fontWeight: 700 }}>KCL credit boost (stake)</div>
            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
              Stake KCL to boost the credit limit multiplier (on-chain, verifiable).
            </div>
            <div style={{ marginTop: 8 }}>Your KCL staked: <b>{kclStaked}</b></div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input value={kclStakeAmt} onChange={(e) => setKclStakeAmt(e.target.value)} style={{ flex: 1 }} />
              <button onClick={stakeKCL}>Stake KCL</button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={borrowerLinkStrategy}>Link Strategy</button>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input value={bondAmt} onChange={(e) => setBondAmt(e.target.value)} style={{ flex: 1 }} />
            <button onClick={borrowerPostBond}>Post Bond</button>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input value={borrowAmt} onChange={(e) => setBorrowAmt(e.target.value)} style={{ flex: 1 }} />
            <button onClick={borrowerBorrow}>Borrow → Strategy</button>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input value={repayAmt} onChange={(e) => setRepayAmt(e.target.value)} style={{ flex: 1 }} />
            <button onClick={borrowerRepay}>Repay</button>
          </div>
        </section>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <section style={{ padding: 16, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12 }}>
          <h3>Strategy (Real swap path)</h3>
          <div style={{ opacity: 0.75 }}>
            Trustworthy demo: execute a real swap on Monorail, sending output to the strategy address, then come back and updateEpoch.
          </div>

          <div style={{ marginTop: 10, padding: 12, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }}>
            <div style={{ fontWeight: 700 }}>Monorail (Option A)</div>
            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
              1) Open Monorail • 2) Swap USDC → any token • 3) Use the strategy address as recipient • 4) Return and click updateEpoch()
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => window.open('https://monorail.xyz/', '_blank')}>Open Monorail</button>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(ADDRS.mUSDC);
                  alert('Copied USDC address');
                }}
              >
                Copy USDC address
              </button>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(ADDRS.pool);
                  alert('Copied Klaave pool address');
                }}
              >
                Copy Klaave pool address
              </button>
              <button
                onClick={async () => {
                  const strat = (strategy && strategy !== '—') ? strategy : (account ?? '');
                  if (!strat) return alert('Connect wallet first');
                  await navigator.clipboard.writeText(strat);
                  alert('Copied strategy/recipient address');
                }}
              >
                Copy strategy address
              </button>
            </div>
          </div>

          <div style={{ marginTop: 14, opacity: 0.55, fontSize: 12 }}>
            (Fallback dev tool) Simulated PnL still exists via StrategyMock, but the judge demo should use real swaps.
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input value={pnl} onChange={(e) => setPnl(e.target.value)} style={{ flex: 1 }} />
            <button onClick={strategySimulatePnL}>Simulate PnL</button>
          </div>
        </section>

        <section style={{ padding: 16, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12 }}>
          <h3>Keeper</h3>
          <div style={{ opacity: 0.75 }}>
            Anyone can advance epochs. This is the “no human in loop” heartbeat.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={keeperUpdateEpoch}>updateEpoch()</button>
            <button onClick={() => setRefresh((x) => x + 1)}>Refresh</button>
          </div>
        </section>
      </div>

      <footer style={{ marginTop: 24, opacity: 0.7, fontSize: 12 }}>
        This is v0 UI. Next: real Monorail swap execution + multi-agent roles + keeper automation.
      </footer>
    </div>
  );
}
