import { ethers } from 'ethers';
import { TronWeb } from 'tronweb';
import config from '../config/env.js';
import { getProvider } from '../config/blockchain.js';
import { tronToHex, tronUsdtBalance } from './tron.js';
import { toDecimal } from './money.js';

// Direct hot-wallet payouts — the backend holds the payout wallet keys and
// sends USDT straight to the user, no contract claim step.

const ERC20_ABI = [
  'function transfer(address to, uint256 value) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
];

// Gas floors: below these the send would just burn the attempt — fall back to manual.
const MIN_BNB = ethers.parseEther('0.0003');
const MIN_TRX_SUN = 30_000_000n; // 30 TRX — covers a USDT transfer with no energy

function keyFor(network) {
  return network === 'TRC20' ? config.hotWallet.tronPrivateKey : config.hotWallet.bep20PrivateKey;
}

function decimalsFor(network) {
  return network === 'TRC20' ? config.tron.usdtDecimals : config.blockchain.usdtDecimals;
}

export function hotWalletConfigured(network) {
  return !!keyFor(network);
}

export function hotWalletAddress(network) {
  const key = keyFor(network);
  if (!key) return null;
  return network === 'TRC20'
    ? TronWeb.address.fromPrivateKey(key)
    : new ethers.Wallet(key).address;
}

// USDT balance of the hot wallet, in raw token units.
export async function hotWalletUsdtBalance(network) {
  const addr = hotWalletAddress(network);
  if (!addr) return 0n;
  if (network === 'TRC20') return tronUsdtBalance(addr);
  const usdt = new ethers.Contract(config.blockchain.usdtContract, ERC20_ABI, getProvider());
  return usdt.balanceOf(addr);
}

// Native balance (BNB / TRX) enough to cover one USDT transfer?
export async function hotWalletHasGas(network) {
  const addr = hotWalletAddress(network);
  if (!addr) return false;
  if (network === 'TRC20') {
    const res = await fetch(`${config.tron.rpcUrl}/wallet/getaccount`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: tronToHex(addr) }),
      signal: AbortSignal.timeout(15000),
    });
    const acc = res.ok ? await res.json() : {};
    return BigInt(acc?.balance ?? 0) >= MIN_TRX_SUN;
  }
  const bnb = await getProvider().getBalance(addr);
  return bnb >= MIN_BNB;
}

export function hotWalletRawAmount(network, amountUsd) {
  return ethers.parseUnits(toDecimal(amountUsd).toFixed(decimalsFor(network)), decimalsFor(network));
}

// Send USDT hot wallet → user. Resolves with the tx hash only after the tx is
// confirmed on-chain; throws otherwise so the caller can fall back to manual.
export async function sendHotWalletPayout(network, toAddress, amountUsd) {
  const key = keyFor(network);
  if (!key) throw new Error(`No hot wallet key configured for ${network}`);
  const raw = hotWalletRawAmount(network, amountUsd);
  return network === 'TRC20'
    ? sendTronPayout(key, toAddress, raw)
    : sendBep20Payout(key, toAddress, raw);
}

async function sendBep20Payout(key, toAddress, raw) {
  const wallet = new ethers.Wallet(key, getProvider());
  const usdt = new ethers.Contract(config.blockchain.usdtContract, ERC20_ABI, wallet);
  const tx = await usdt.transfer(ethers.getAddress(toAddress), raw);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error(`BEP20 payout tx failed: ${tx.hash}`);
  return tx.hash;
}

async function sendTronPayout(key, toAddress, raw) {
  const tw = new TronWeb({ fullHost: config.tron.rpcUrl, privateKey: key });
  const usdt = await tw.contract().at(config.tron.usdtContract);
  const txid = await usdt.transfer(toAddress, raw.toString()).send({ feeLimit: 100_000_000 });

  // Confirm before completing — ~3s block time, allow up to 90s.
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const info = await fetch(`${config.tron.rpcUrl}/wallet/gettransactioninfobyid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: txid }),
      signal: AbortSignal.timeout(15000),
    })
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
    if (info?.blockNumber) {
      if (info?.receipt?.result === 'SUCCESS') return txid;
      throw new Error(`TRC20 payout tx failed on-chain: ${txid}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`TRC20 payout tx not confirmed in time: ${txid}`);
}
