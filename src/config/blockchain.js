import { ethers } from 'ethers';
import config from './env.js';

let provider = null;

export function getProvider() {
  if (!provider) {
    if (!config.blockchain.rpcUrl) {
      throw new Error('BLOCKCHAIN_RPC_URL is not configured');
    }
    provider = new ethers.JsonRpcProvider(config.blockchain.rpcUrl);
  }
  return provider;
}

export const ERC20_TRANSFER_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];
