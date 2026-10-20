import rateLimit from 'express-rate-limit';
import config from '../config/env.js';

const isProd = config.nodeEnv === 'production';
const lim = (prodMax) => (isProd ? prodMax : 1000);

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: lim(5), // 5 requests per window (prod); relaxed in dev
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later',
    errorCode: 'RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: lim(100), // 100 requests per window (prod)
  message: {
    success: false,
    message: 'Too many requests, please try again later',
    errorCode: 'RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const investmentRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: lim(10), // 10 investment requests per hour (prod)
  message: {
    success: false,
    message: 'Too many investment requests, please try again later',
    errorCode: 'RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const withdrawalRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: lim(3), // 3 withdrawal requests per hour (prod)
  message: {
    success: false,
    message: 'Too many withdrawal requests, please try again later',
    errorCode: 'RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
});
