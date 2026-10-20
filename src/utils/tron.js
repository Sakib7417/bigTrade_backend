import crypto from 'crypto';
import config from '../config/env.js';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// TRC20 Transfer event signature topic (same keccak as ERC20)
const TRANSFER_TOPIC = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// base58check decode — Tron address "T..." -> hex "41..." (21 bytes)
export function tronToHex(address) {
  if (typeof address !== 'string' || !address.length) throw new Error('empty address');
  let num = 0n;
  for (const ch of address) {
    const i = B58.indexOf(ch);
    if (i < 0) throw new Error('invalid base58 character');
    num = num * 58n + BigInt(i);
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  let bytes = Buffer.from(hex, 'hex');
  let zeros = 0;
  while (address[zeros] === '1') zeros++;
  if (zeros) bytes = Buffer.concat([Buffer.alloc(zeros), bytes]);

  if (bytes.length !== 25 || bytes[0] !== 0x41) throw new Error('invalid tron address');
  const payload = bytes.subarray(0, 21);
  const checksum = bytes.subarray(21);
  const hash = crypto
    .createHash('sha256')
    .update(crypto.createHash('sha256').update(payload).digest())
    .digest();
  if (!checksum.equals(hash.subarray(0, 4))) throw new Error('invalid tron checksum');
  return '41' + payload.subarray(1).toString('hex');
}

export function tronHexToBase58(hexAddr) {
  const payload = Buffer.from(hexAddr, 'hex');
  const hash = crypto
    .createHash('sha256')
    .update(crypto.createHash('sha256').update(payload).digest())
    .digest();
  const full = Buffer.concat([payload, hash.subarray(0, 4)]);
  let num = BigInt('0x' + full.toString('hex'));
  let out = '';
  while (num > 0n) {
    out = B58[Number(num % 58n)] + out;
    num /= 58n;
  }
  for (const b of full) {
    if (b === 0) out = '1' + out;
    else break;
  }
  return out;
}

export function isTronAddress(a) {
  try {
    tronToHex(a);
    return true;
  } catch {
    return false;
  }
}

async function tronPost(path, body) {
  const res = await fetch(`${config.tron.rpcUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`TronGrid error ${res.status}`);
  return res.json();
}

// Verify a TRC20 USDT transfer on Tron. toWallets = configured platform
// wallets (base58). Returns transfer details when one matches.
export async function verifyTronUsdtTransfer(txHash, toWallets) {
  const usdtHex = tronToHex(config.tron.usdtContract).toLowerCase();
  const toSet = new Set(toWallets.map((w) => tronToHex(w).toLowerCase()));

  const [tx, info, now] = await Promise.all([
    tronPost('/walletsolidity/gettransactionbyid', { value: txHash }),
    tronPost('/walletsolidity/gettransactioninfobyid', { value: txHash }),
    tronPost('/wallet/getnowblock', {}),
  ]);

  if (!tx?.txID) return { found: false };
  if (info?.receipt?.result !== 'SUCCESS') return { found: true, failed: true };

  let matched = null;
  for (const log of info.log ?? []) {
    if ((log.address ?? '').toLowerCase() !== usdtHex) continue;
    const [sig, fromTopic, toTopic] = log.topics ?? [];
    if (sig !== TRANSFER_TOPIC || !toTopic || !log.data) continue;
    const toHex = ('41' + toTopic.slice(-40)).toLowerCase();
    if (!toSet.has(toHex)) continue;
    matched = {
      fromHex: '41' + (fromTopic ?? '').slice(-40),
      toHex,
      amount: BigInt('0x' + log.data),
    };
    break;
  }

  if (!matched) return { found: true, failed: false, notPlatform: true };

  const latest = now?.block_header?.raw_data?.number ?? 0;
  const confirmations = Math.max(0, latest - (info.blockNumber ?? 0) + 1);
  return { found: true, failed: false, matched, confirmations };
}
