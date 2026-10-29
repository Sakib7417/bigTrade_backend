import { ethers } from 'ethers';
import config from '../config/env.js';
import { tronToHex, isTronAddress } from './tron.js';
import { getProvider, ERC20_TRANSFER_ABI } from '../config/blockchain.js';
import { ConflictError } from '../middleware/error.middleware.js';
import { toDecimal } from './money.js';

const transferIface = new ethers.Interface(ERC20_TRANSFER_ABI);

// ---- address / amount normalization ----

// Contract-side "address" is the raw 20-byte EVM form for both chains:
//   BEP20 user address  0xAbC...          -> itself
//   TRC20 user address  T...  ->  0x + last 40 hex of tronToHex (drops 0x41)
function toEvmAddress(network, address) {
  if (network === 'TRC20') {
    if (!isTronAddress(address)) {
      throw new ConflictError('Invalid TRC20 (Tron) address');
    }
    return '0x' + tronToHex(address).slice(2);
  }
  if (!ethers.isAddress(address)) {
    throw new ConflictError('Invalid BEP20 (EVM) address');
  }
  return ethers.getAddress(address);
}

function contractFor(network) {
  const c = network === 'TRC20' ? config.payout.contractTrc20 : config.payout.contractBep20;
  return c || null;
}

function contractEvmAddress(network) {
  const c = contractFor(network);
  if (!c) return null;
  return network === 'TRC20' ? '0x' + tronToHex(c).slice(2) : ethers.getAddress(c);
}

function decimalsFor(network) {
  return network === 'TRC20' ? config.tron.usdtDecimals : config.blockchain.usdtDecimals;
}

// ---- feature gate ----

export function autoClaimAvailable(network, netAmountUsd) {
  if (!config.payout.autoClaimEnabled) return false;
  if (!config.payout.signerPrivateKey) return false;
  if (!contractFor(network)) return false;
  return toDecimal(netAmountUsd).lte(config.payout.autoClaimMaxUsd);
}

// ---- voucher issuing ----

let nonceCounter = 0;

// Returns the claim data the frontend needs to call contract.claim().
export async function signClaimVoucher(network, destinationAddress, netAmountUsd) {
  const contract = contractFor(network);
  if (!contract) throw new ConflictError(`Payout contract not configured for ${network}`);

  const toEvm = toEvmAddress(network, destinationAddress);
  const contractEvm = contractEvmAddress(network);
  const amountRaw = ethers.parseUnits(
    toDecimal(netAmountUsd).toFixed(decimalsFor(network)),
    decimalsFor(network)
  );
  const expiry = Math.floor(Date.now() / 1000) + config.payout.voucherTtlHours * 3600;
  // Unique, monotonic nonce — included in the digest which is replay-protected
  // on-chain anyway.
  const nonce = BigInt(Date.now()) * 1000n + BigInt((nonceCounter = (nonceCounter + 1) % 1000));

  const digest = ethers.solidityPackedKeccak256(
    ['address', 'address', 'uint256', 'uint256', 'uint256'],
    [contractEvm, toEvm, amountRaw, nonce, expiry]
  );

  const wallet = new ethers.Wallet(config.payout.signerPrivateKey);
  const signature = await wallet.signMessage(ethers.getBytes(digest));

  return {
    network,
    contract,
    to: destinationAddress,
    amountRaw: amountRaw.toString(),
    nonce: nonce.toString(),
    expiry,
    signature,
  };
}

// ---- on-chain payout verification ----

// BEP20: claim() makes the vault transfer USDT vault -> user.
export async function verifyBep20Payout(txHash, contractAddress, toAddress, minRawAmount) {
  const provider = getProvider();
  const receipt = await provider.getTransactionReceipt(txHash).catch(() => null);

  if (!receipt || receipt.status !== 1) {
    throw new ConflictError('Claim transaction not found or failed on-chain');
  }

  const contractEvm = ethers.getAddress(contractAddress).toLowerCase();
  const toEvm = toEvmAddress('BEP20', toAddress).toLowerCase();

  const transfer = receipt.logs
    .filter(
      (log) => log.address.toLowerCase() === config.blockchain.usdtContract?.toLowerCase()
    )
    .map((log) => {
      try {
        return transferIface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find(
      (parsed) =>
        parsed &&
        parsed.name === 'Transfer' &&
        parsed.args.from.toLowerCase() === contractEvm &&
        parsed.args.to.toLowerCase() === toEvm
    );

  if (!transfer) {
    throw new ConflictError('Transaction is not a vault payout to the withdrawal address');
  }

  if (transfer.args.value < BigInt(minRawAmount)) {
    throw new ConflictError('Payout amount is less than the withdrawal amount');
  }

  return { found: true, from: transfer.args.from, amountRaw: transfer.args.value.toString() };
}
