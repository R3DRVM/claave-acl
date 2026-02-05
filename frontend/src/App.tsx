import { useEffect, useMemo, useState } from 'react';
import './index.css';
import { ADDRS, CHAIN_ID, EXPLORER } from './claave/constants';
import { ACL_ABI, ACLPOOL_ABI, ERC20_ABI, STAKING_ABI, STRATEGYMOCK_ABI } from './claave/abi';
import { contractRead, contractWrite, ensureMonadChain, getInjectedProvider, getReadonlyProvider } from './claave/eth';
import { formatUnits, getBytes, parseUnits, ZeroAddress } from 'ethers';
import {
  Banknote,
  Coins,
  Link2,
  RefreshCw,
  Shield,
  Wallet,
  ArrowDownToLine,
  ArrowUpFromLine,
  Vault,
  Info,
  SlidersHorizontal
} from 'lucide-react';

import { AmountChips, Hint, Pill, SmallLabel } from './claave/ui';

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

  // UI mode
  const [mode, setMode] = useState<'lend' | 'borrow' | 'keeper'>('lend');

  // last txs (for judges)
  const [txDeposit, setTxDeposit] = useState<string>('');
  const [txLink, setTxLink] = useState<string>('');
  const [txBond, setTxBond] = useState<string>('');
  const [txBorrow, setTxBorrow] = useState<string>('');
  const [txEpoch, setTxEpoch] = useState<string>('');
  const [, setTxRepay] = useState<string>('');

  // read state
  const [usdcDecimals, setUsdcDecimals] = useState<number>(6);
  const [usdcBal, setUsdcBal] = useState<string>('—');
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

  const [reserveAddr, setReserveAddr] = useState<string>('—');
  const [reserveBal, setReserveBal] = useState<string>('—');
  const [borrowFeeBps, setBorrowFeeBps] = useState<string>('—');
  const [feesAccrued, setFeesAccrued] = useState<string>('—');

  // inputs
  const [depositAmt, setDepositAmt] = useState('100');
  const [bondAmt, setBondAmt] = useState('50');
  const [borrowAmt, setBorrowAmt] = useState('10');
  const [repayAmt, setRepayAmt] = useState('10');
  const [strategyAddrInput, setStrategyAddrInput] = useState<string>('');
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

    const myBal = account ? await usdc.balanceOf(account) : 0n;
    setUsdcBal(bnToStr(myBal, Number(dec)));

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

    // fee routing / reserve
    try {
      const r = await acl.reserve();
      setReserveAddr(r);
      const bps = await acl.borrowFeeBps();
      setBorrowFeeBps(bps.toString());
      const fa = await acl.feesAccrued();
      setFeesAccrued(bnToStr(fa, Number(dec)));
      const rb = await usdc.balanceOf(r);
      setReserveBal(bnToStr(rb, Number(dec)));
    } catch {
      // ignore if connected to non-fee ACL
    }
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
    setTxDeposit(tx.hash);
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
    setTxBond(tx.hash);
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
    // Default strategy is the borrower EOA unless a custom address is provided.
    const strategyAddr = (strategyAddrInput && strategyAddrInput.trim().length > 0)
      ? strategyAddrInput.trim()
      : account;

    // match solidity: keccak256(abi.encodePacked("ACL_LINK", address(this), msg.sender, strategy));
    const { solidityPackedKeccak256 } = await import('ethers');
    const raw = solidityPackedKeccak256(
      ['string', 'address', 'address', 'address'],
      ['ACL_LINK', ADDRS.acl, account, strategyAddr]
    );
    const sig = await signer.signMessage(getBytes(raw));

    const tx = await acl.linkStrategy(strategyAddr, sig);
    setTxLink(tx.hash);
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
    setTxBorrow(tx.hash);
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
    setTxRepay(tx.hash);
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
    setTxEpoch(tx.hash);
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

  const stepConnected = !!account;
  const stepDeposit = poolAssets !== '—' && Number(poolAssets) > 0;
  const stepLinked = strategy !== '—' && strategy !== '';
  const stepBonded = bond !== '—' && Number(bond) > 0;
  const stepBorrowed = debt !== '—' && Number(debt) > 0;
  const stepEpoch = txEpoch.length > 0;

  function Step({
    n,
    title,
    done,
    tx
  }: {
    n: number;
    title: string;
    done: boolean;
    tx?: string;
  }) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: done ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.03)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="k-mono" style={{ width: 22, textAlign: 'center', opacity: 0.85 }}>{n}</div>
          <div style={{ fontWeight: 700 }}>{title}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 12, opacity: done ? 0.95 : 0.5 }}>{done ? 'done' : 'pending'}</div>
          {tx ? (
            <a className="k-mono" style={{ fontSize: 12, opacity: 0.8 }} href={EXPLORER.tx(tx)} target="_blank" rel="noreferrer">
              {short(tx)}
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 0.6 }}>KLAAVE</div>
          <div className="k-muted">Agent-native credit lines on Monad</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <Pill active={mode === 'lend'} onClick={() => setMode('lend')}>Lend</Pill>
            <Pill active={mode === 'borrow'} onClick={() => setMode('borrow')}>Borrow</Pill>
            <Pill active={mode === 'keeper'} onClick={() => setMode('keeper')}>Keeper</Pill>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="k-mono">{account ? short(account) : '—'}</div>
          <button onClick={connect} style={{ marginTop: 8 }}>{account ? 'Connected' : 'Connect wallet'}</button>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>{status} • chain {CHAIN_ID}</div>
          <div style={{ marginTop: 10 }}>
            <SmallLabel>Your USDC</SmallLabel>
            <div style={{ fontWeight: 800 }}>{usdcBal}</div>
          </div>
        </div>
      </header>

      <section className="k-card" style={{ marginTop: 16, padding: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 900, letterSpacing: 0.2 }}>
              <Info size={16} /> Start here
            </div>
            <Hint>
              This UI is usable by humans and agents. If you are new: start in Lend mode. If you are an agent: switch to Borrow.
            </Hint>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
              <a href={EXPLORER.address(ADDRS.acl)} target="_blank" rel="noreferrer">View ACL</a>
              <a href={EXPLORER.address(ADDRS.pool)} target="_blank" rel="noreferrer">View pool</a>
              <a href={EXPLORER.address(ADDRS.mUSDC)} target="_blank" rel="noreferrer">View USDC</a>
              {'reserve' in ADDRS ? <a href={EXPLORER.address((ADDRS as any).reserve)} target="_blank" rel="noreferrer">View reserve</a> : null}
            </div>

            <div style={{ marginTop: 14, padding: 12, borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800 }}>
                <SlidersHorizontal size={16} /> What to do
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
                <div>
                  <SmallLabel>Lend</SmallLabel>
                  <div style={{ fontWeight: 700, marginTop: 2 }}>Deposit USDC</div>
                  <Hint>Earn pool yield from agent borrowing fees over time.</Hint>
                </div>
                <div>
                  <SmallLabel>Borrow</SmallLabel>
                  <div style={{ fontWeight: 700, marginTop: 2 }}>Bond + borrow</div>
                  <Hint>Post a security deposit and borrow to your recipient wallet.</Hint>
                </div>
              </div>
            </div>

            <details style={{ marginTop: 14 }}>
              <summary style={{ cursor: 'pointer', opacity: 0.9, fontWeight: 800 }}>Agent ops (CLI)</summary>
              <div className="k-mono" style={{ fontSize: 12, whiteSpace: 'pre-wrap', opacity: 0.9, marginTop: 10 }}>
{`RPC_URL=https://rpc.monad.xyz
USDC=${ADDRS.mUSDC}
POOL=${ADDRS.pool}
ACL=${ADDRS.acl}

# deposit (lender)
cast send $USDC "approve(address,uint256)" $POOL <amt> --private-key $PRIVATE_KEY --rpc-url $RPC_URL
cast send $POOL "deposit(uint256,address)" <amt> $ADDRESS --private-key $PRIVATE_KEY --rpc-url $RPC_URL

# link recipient (borrower)
RPC_URL=$RPC_URL PRIVATE_KEY=$PRIVATE_KEY ACL=$ACL node scripts/linkStrategy.js

# bond + borrow
cast send $USDC "approve(address,uint256)" $ACL <amt> --private-key $PRIVATE_KEY --rpc-url $RPC_URL
cast send $ACL "postBond(uint256)" <amt> --private-key $PRIVATE_KEY --rpc-url $RPC_URL
cast send $ACL "borrow(uint256)" <amt> --private-key $PRIVATE_KEY --rpc-url $RPC_URL

# keeper
node scripts/keeper_updateEpoch.js $ACL`}
              </div>
            </details>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontWeight: 900, letterSpacing: 0.2 }}>Demo rail</div>
            <Step n={1} title="Connect wallet" done={stepConnected} />
            <Step n={2} title="Deposit USDC" done={stepDeposit} tx={txDeposit} />
            <Step n={3} title="Set recipient wallet" done={stepLinked} tx={txLink} />
            <Step n={4} title="Security deposit (bond)" done={stepBonded} tx={txBond} />
            <Step n={5} title="Borrow" done={stepBorrowed} tx={txBorrow} />
            <Step n={6} title="Refresh credit score" done={stepEpoch} tx={txEpoch} />
          </div>
        </div>
      </section>

      <section className="k-card" style={{ marginTop: 24, padding: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <a href={EXPLORER.address(ADDRS.acl)} target="_blank" rel="noreferrer">ACL Contract</a>
          <a href={EXPLORER.address(ADDRS.pool)} target="_blank" rel="noreferrer">Pool</a>
          <a href={EXPLORER.address(ADDRS.mUSDC)} target="_blank" rel="noreferrer">mUSDC</a>
          <a href={EXPLORER.nadToken(ADDRS.tokenKCL)} target="_blank" rel="noreferrer">KCL on nad.fun</a>
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        {mode === 'lend' ? (
          <section className="k-card" style={{ padding: 16 }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 0 }}>
              <Banknote size={18} /> Lend (earn)
            </h3>
            <Hint>
              You deposit USDC into the pool. Borrowers pay fees that accrue to the protocol reserve.
            </Hint>
            <div style={{ marginTop: 10 }}>Pool assets: <b>{poolAssets}</b> USDC</div>
            <div>Available liquidity: <b>{poolLiquidity}</b> USDC</div>
            <div style={{ marginTop: 12 }}>
              <SmallLabel>Choose an amount</SmallLabel>
              <AmountChips values={['10', '50', '100']} onPick={setDepositAmt} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input value={depositAmt} onChange={(e) => setDepositAmt(e.target.value)} style={{ flex: 1 }} />
              <button onClick={lenderDeposit}>Deposit USDC</button>
            </div>
            {txDeposit ? (
              <div style={{ marginTop: 10 }}>
                <SmallLabel>Latest deposit tx</SmallLabel>
                <a className="k-mono" href={EXPLORER.tx(txDeposit)} target="_blank" rel="noreferrer">{txDeposit}</a>
              </div>
            ) : null}
          </section>
        ) : (
          <section className="k-card" style={{ padding: 16, opacity: 0.6 }}>
            <h3 style={{ marginTop: 0 }}>Lend (earn)</h3>
            <Hint>Switch to Lend mode to deposit.</Hint>
          </section>
        )}

        {mode === 'borrow' ? (
          <section className="k-card" style={{ padding: 16 }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 0 }}>
              <Wallet size={18} /> Borrow (agent)
            </h3>
          <div>Strategy: <b>{strategy === '—' ? '—' : short(strategy)}</b></div>
          <div>Equity: <b>{equity}</b> mUSDC</div>
          <div>Bond: <b>{bond}</b> mUSDC</div>
          <div>Debt: <b>{debt}</b> mUSDC</div>
          <div>Score: <b>{score}</b> | failures: <b>{failures}</b> | frozen: <b>{frozen}</b></div>
          <div>Credit limit: <b>{creditLimit}</b> | available: <b>{available}</b></div>

          <div style={{ marginTop: 12, padding: 12, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
              <Shield size={16} /> KCL credit boost (stake)
            </div>
            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
              Stake KCL to boost the credit limit multiplier (on-chain, verifiable).
            </div>
            <div style={{ marginTop: 8 }}>Your KCL staked: <b>{kclStaked}</b></div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input value={kclStakeAmt} onChange={(e) => setKclStakeAmt(e.target.value)} style={{ flex: 1 }} />
              <button onClick={stakeKCL}>Stake KCL</button>
            </div>
          </div>

          <div style={{ marginTop: 12, padding: 12, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
              <Link2 size={16} /> Strategy link
            </div>
            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
              The strategy address receives borrowed funds. Leave blank to use your connected wallet.
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input
                placeholder="0x… (optional)"
                value={strategyAddrInput}
                onChange={(e) => setStrategyAddrInput(e.target.value)}
                style={{ flex: 1 }}
              />
              <button onClick={borrowerLinkStrategy}>Link</button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input value={bondAmt} onChange={(e) => setBondAmt(e.target.value)} style={{ flex: 1 }} />
            <button onClick={borrowerPostBond}><ArrowDownToLine size={16} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />Post Bond</button>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input value={borrowAmt} onChange={(e) => setBorrowAmt(e.target.value)} style={{ flex: 1 }} />
            <button onClick={borrowerBorrow}><ArrowUpFromLine size={16} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />Borrow to strategy</button>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input value={repayAmt} onChange={(e) => setRepayAmt(e.target.value)} style={{ flex: 1 }} />
            <button onClick={borrowerRepay}><Coins size={16} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />Repay</button>
          </div>

          <div style={{ marginTop: 12, padding: 12, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
              <Vault size={16} /> Protocol reserve
            </div>
            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
              Borrow fees route here. This is the protocol treasury primitive.
            </div>
            <div style={{ marginTop: 8 }}>Reserve: <span className="k-mono">{reserveAddr === '—' ? '—' : short(reserveAddr)}</span></div>
            <div>Reserve balance: <b>{reserveBal}</b> USDC</div>
            <div>Borrow fee: <b>{borrowFeeBps}</b> bps | Fees accrued: <b>{feesAccrued}</b> USDC</div>
          </div>
        </section>
        ) : (
          <section className="k-card" style={{ padding: 16, opacity: 0.6 }}>
            <h3 style={{ marginTop: 0 }}>Borrow (agent)</h3>
            <Hint>Switch to Borrow mode to post a bond and borrow.</Hint>
          </section>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <section className="k-card" style={{ padding: 16 }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 0 }}>
            <Coins size={18} /> Strategy (Real swap path)
          </h3>
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

        <section className="k-card" style={{ padding: 16 }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 0 }}>
            <RefreshCw size={18} /> Keeper
          </h3>
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
