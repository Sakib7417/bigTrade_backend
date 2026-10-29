// Sweep USDT out of a payout vault (emergencyWithdraw — owner only).
//
//   node --env-file=.env scripts/payout-sweep.js BEP20 <to> <amount>
//   node --env-file=.env scripts/payout-sweep.js TRC20 <to> <amount>
//
// <amount> in USDT (e.g. 200) or "all" for the full vault balance.
// BEP20 owner = PAYOUT_SIGNER_PRIVATE_KEY (from .env).
// TRC20 owner = whoever deployed — set TRON_DEPLOYER_PRIVATE_KEY in .env first,
// or use TronScan's Write Contract tab with TronLink instead.
import { ethers } from 'ethers';
import solc from 'solc';
import { readFileSync } from 'node:fs';
import { getProvider } from '../src/config/blockchain.js';

const [, , network, to, amountArg] = process.argv;
if (!['BEP20', 'TRC20'].includes(network) || !to || !amountArg) {
  console.error('Usage: node --env-file=.env scripts/payout-sweep.js <BEP20|TRC20> <to> <amount|all>');
  process.exit(1);
}

const source = readFileSync(new URL('../contracts/BigTradePayout.sol', import.meta.url), 'utf8');
const compiled = JSON.parse(
  solc.compile(JSON.stringify({
    language: 'Solidity',
    sources: { 'BigTradePayout.sol': { content: source } },
    settings: { outputSelection: { '*': { '*': ['abi'] } } },
  }))
);
const ABI = compiled.contracts['BigTradePayout.sol'].BigTradePayout.abi;

if (network === 'BEP20') {
  const provider = getProvider();
  const wallet = new ethers.Wallet(process.env.PAYOUT_SIGNER_PRIVATE_KEY, provider);
  const vault = new ethers.Contract(process.env.PAYOUT_CONTRACT_BEP20, ABI, wallet);
  const usdt = new ethers.Contract(process.env.USDT_CONTRACT_ADDRESS, ['function balanceOf(address) view returns (uint256)'], provider);
  const decimals = Number(process.env.USDT_DECIMALS || 18);
  const bal = await usdt.balanceOf(await vault.getAddress());
  const amount = amountArg === 'all' ? bal : ethers.parseUnits(amountArg, decimals);
  console.log(`Vault balance: ${ethers.formatUnits(bal, decimals)} USDT — sweeping ${ethers.formatUnits(amount, decimals)} to ${to}`);
  const tx = await vault.emergencyWithdraw(to, amount);
  console.log('tx:', tx.hash);
  await tx.wait();
  console.log('Done.');
} else {
  const key = (process.env.TRON_DEPLOYER_PRIVATE_KEY || '').replace(/^0x/, '');
  if (!key) {
    console.error('TRON_DEPLOYER_PRIVATE_KEY not set — add the vault-owner wallet key to .env (owner = the wallet that deployed the contract), or sweep via TronScan Write Contract with TronLink.');
    process.exit(1);
  }
  const { TronWeb } = await import('tronweb');
  const tw = new TronWeb({ fullHost: process.env.TRON_RPC_URL, privateKey: key });
  const vault = await tw.contract(ABI, process.env.PAYOUT_CONTRACT_TRC20);
  const decimals = Number(process.env.TRON_USDT_DECIMALS || 6);
  const bal = BigInt((await vault.vaultBalance().call()).toString());
  const amount = amountArg === 'all' ? bal : BigInt(Math.round(Number(amountArg) * 10 ** decimals));
  console.log(`Vault balance: ${Number(bal) / 10 ** decimals} USDT — sweeping ${Number(amount) / 10 ** decimals} to ${to}`);
  const txid = await vault.emergencyWithdraw(to, amount.toString()).send({ feeLimit: 50_000_000 });
  console.log('tx:', txid);
  console.log('Done.');
}
