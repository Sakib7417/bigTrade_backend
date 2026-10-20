import dotenv from 'dotenv';

dotenv.config();

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 5000,
  databaseUrl: process.env.DATABASE_URL,
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '30d',
  },
  investment: {
    minAmount: parseInt(process.env.MIN_INVESTMENT, 10) || 100,
  },
  withdrawal: {
    minAmount: parseInt(process.env.MIN_WITHDRAWAL, 10) || 10,
    feePercent: parseFloat(process.env.WITHDRAWAL_FEE_PERCENT) || 5,
    earlyPrincipalPenaltyPercent: parseFloat(process.env.EARLY_PRINCIPAL_PENALTY_PERCENT) || 10,
  },
  commission: {
    directPercent: parseFloat(process.env.DIRECT_COMMISSION_PERCENT) || 5,
    maxLevel: parseInt(process.env.MAX_REFERRAL_LEVEL, 10) || 20,
  },
  roi: {
    minPercent: parseFloat(process.env.MIN_ROI_PERCENT) || 6,
    maxPercent: parseFloat(process.env.MAX_ROI_PERCENT) || 12,
  },
  admin: {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  },
  blockchain: {
    network: process.env.BLOCKCHAIN_NETWORK || 'bsc-testnet',
    rpcUrl: process.env.BLOCKCHAIN_RPC_URL,
    usdtContract: process.env.USDT_CONTRACT_ADDRESS,
    depositWallet: process.env.PLATFORM_DEPOSIT_WALLET,
    requiredConfirmations: parseInt(process.env.BLOCKCHAIN_REQUIRED_CONFIRMATIONS, 10) || 12,
    usdtDecimals: parseInt(process.env.USDT_DECIMALS, 10) || 18,
  },
  brevo: {
    apiKey: process.env.BREVO_API_KEY || '',
    senderEmail: process.env.BREVO_SENDER_EMAIL || 'noreply@bigtrade.local',
    senderName: process.env.BREVO_SENDER_NAME || 'BigTrade',
    otpMinutes: parseInt(process.env.OTP_EXPIRY_MINUTES, 10) || 10,
  },
  tron: {
    rpcUrl: process.env.TRON_RPC_URL || 'https://nile.trongrid.io',
    usdtContract: process.env.TRON_USDT_CONTRACT || '',
    requiredConfirmations: parseInt(process.env.TRON_REQUIRED_CONFIRMATIONS, 10) || 19,
    usdtDecimals: parseInt(process.env.TRON_USDT_DECIMALS, 10) || 6,
  },
};

export default config;
