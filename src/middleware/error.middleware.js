import logger from '../config/logger.js';
import { Prisma } from '@prisma/client';

export const errorHandler = (err, req, res, next) => {
  logger.error('Error:', err);

  // Prisma errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: 'A record with this value already exists',
        errorCode: 'DUPLICATE_RECORD',
      });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({
        success: false,
        message: 'Record not found',
        errorCode: 'NOT_FOUND',
      });
    }
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: err.message,
      errorCode: 'VALIDATION_ERROR',
      details: err.details,
    });
  }

  // Authentication errors
  if (err.name === 'AuthenticationError') {
    return res.status(401).json({
      success: false,
      message: err.message,
      errorCode: err.errorCode || 'AUTHENTICATION_ERROR',
    });
  }

  // Authorization errors
  if (err.name === 'AuthorizationError') {
    return res.status(403).json({
      success: false,
      message: err.message,
      errorCode: 'AUTHORIZATION_ERROR',
    });
  }

  // Not found errors
  if (err.name === 'NotFoundError') {
    return res.status(404).json({
      success: false,
      message: err.message,
      errorCode: 'NOT_FOUND',
    });
  }

  // Conflict errors
  if (err.name === 'ConflictError') {
    return res.status(409).json({
      success: false,
      message: err.message,
      errorCode: 'CONFLICT',
    });
  }

  // Default error
  const statusCode = err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' 
    ? 'Internal server error' 
    : err.message;

  res.status(statusCode).json({
    success: false,
    message,
    errorCode: 'INTERNAL_ERROR',
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
};

export class ValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

export class AuthenticationError extends Error {
  constructor(message, errorCode = null) {
    super(message);
    this.name = 'AuthenticationError';
    this.errorCode = errorCode;
  }
}

export class AuthorizationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConflictError';
  }
}
