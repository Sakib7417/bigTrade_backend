// Deploys contracts/BigTradePayout.sol to the Tron network in TRON_RPC_URL
// (Nile testnet locally, mainnet on the server).
//
//   node --env-file=.env scripts/deploy-tron-payout.js
//
// Deployer = TRON_DEPLOYER_PRIVATE_KEY if set (pays deploy fee, becomes owner),
// otherwise the payout signer key deploys. The contract `signer` is ALWAYS the
// PAYOUT_SIGNER_PRIVATE_KEY wallet — the backend signs vouchers with it.
import { TronWeb } from 'tronweb';
import solc from 'solc';
import { readFileSync } from 'node:fs';

const RPC = process.env.TRON_RPC_URL;
const USDT = process.env.TRON_USDT_CONTRACT;
const SIGNER_KEY = (process.env.PAYOUT_SIGNER_PRIVATE_KEY || '').replace(/^0x/, '');
const DEPLOYER_KEY = (process.env.TRON_DEPLOYER_PRIVATE_KEY || SIGNER_KEY).replace(/^0x/, '');
const MAX_PER_CLAIM = BigInt(process.env.PAYOUT_MAX_PER_CLAIM_USDT || '500') * 10n ** 6n;
const DAILY = BigInt(process.env.PAYOUT_DAILY_LIMIT_USDT || '2000') * 10n ** 6n;

if (!RPC || !USDT || !SIGNER_KEY) {
  console.error('Missing TRON_RPC_URL / TRON_USDT_CONTRACT / PAYOUT_SIGNER_PRIVATE_KEY in env');
  process.exit(1);
}

const source = readFileSync(new URL('../contracts/BigTradePayout.sol', import.meta.url), 'utf8');
const compiled = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: 'Solidity',
      sources: { 'BigTradePayout.sol': { content: source } },
      settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } } },
    })
  )
);
if (compiled.errors?.some((e) => e.severity === 'error')) {
  console.error(compiled.errors.filter((e) => e.severity === 'error'));
  process.exit(1);
}
const out = compiled.contracts['BigTradePayout.sol'].BigTradePayout;

const tronWeb = new TronWeb({ fullHost: RPC, privateKey: DEPLOYER_KEY });
const deployer = tronWeb.address.fromPrivateKey(DEPLOYER_KEY);
const signer = tronWeb.address.fromPrivateKey(SIGNER_KEY);
console.log(`Deployer : ${deployer}  (owner)`);
console.log(`Signer   : ${signer}  (voucher signer)`);
console.log(`USDT     : ${USDT}`);
console.log(`Limits   : ${Number(MAX_PER_CLAIM) / 1e6} USDT/claim · ${Number(DAILY) / 1e6} USDT/day`);

const acct = await tronWeb.trx.getAccount(deployer).catch(() => null);
const trx = (acct?.balance ?? 0) / 1e6;
console.log(`Balance  : ${trx} TRX`);
if (trx < 50) {
  console.error('\nNot enough TRX to deploy — fund the deployer first (Nile faucet or send TRX).');
  process.exit(1);
}

console.log('\nDeploying…');
const contract = await tronWeb.contract().new({
  abi: out.abi,
  bytecode: out.evm.bytecode.object,
  feeLimit: 1_500_000_000, // 1500 TRX max — TVM burns TRX if no energy
  userFeePercentage: 100,
  originEnergyLimit: 10_000_000,
  parameters: [USDT, signer, MAX_PER_CLAIM.toString(), DAILY.toString()],
});

console.log(`\nDeployed at: ${contract.address}`);
console.log(`\nAdd to .env:`);
console.log(`PAYOUT_CONTRACT_TRC20=${contract.address}`);
console.log(`Then send TUSDT to ${contract.address} to fund the payout vault.`);
