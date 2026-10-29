// Deploy BigTradePayout to an EVM chain (BSC testnet/mainnet).
//
// Usage:
//   DEPLOYER_KEY=0x... RPC_URL=https://bsc-testnet-rpc.publicnode.com \
//   USDT=0x1F71139BACbf9Ab15d239342f7783C69951736f7 \
//   SIGNER=0xSignerAddress MAX_PER_CLAIM_USD=500 DAILY_LIMIT_USD=2000 USDT_DECIMALS=18 \
//   node contracts/deploy.js
//
// For Tron (TRC20): compile BigTradePayout.sol in Remix (Solidity 0.8.20+,
// EVM version "cancun" or lower is not required — TVM supports paris),
// deploy via TronLink, and pass the constructor args in raw token units
// (TRC20 USDT uses 6 decimals). The `signer` arg takes the same EVM
// hex address (0x…) — tronWeb/Remix converts it to the 0x41 form.
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import solc from 'solc';

const dir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(dir, 'BigTradePayout.sol'), 'utf8');

const compiled = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: 'Solidity',
      sources: { 'BigTradePayout.sol': { content: source } },
      settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } } },
    })
  )
);

const c = compiled.contracts['BigTradePayout.sol'].BigTradePayout;
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.DEPLOYER_KEY, provider);
const decimals = parseInt(process.env.USDT_DECIMALS || '18', 10);

const factory = new ethers.ContractFactory(c.abi, c.evm.bytecode.object, wallet);
const contract = await factory.deploy(
  process.env.USDT,
  process.env.SIGNER,
  ethers.parseUnits(process.env.MAX_PER_CLAIM_USD || '500', decimals),
  ethers.parseUnits(process.env.DAILY_LIMIT_USD || '2000', decimals)
);
await contract.waitForDeployment();
console.log('BigTradePayout deployed at:', await contract.getAddress());
console.log('Set PAYOUT_CONTRACT_BEP20 to this address and fund it with USDT.');
