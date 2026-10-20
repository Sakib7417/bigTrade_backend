import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { generalRateLimit } from './middleware/rateLimit.middleware.js';
import { errorHandler } from './middleware/error.middleware.js';
import routes from './routes/index.js';
import logger from './config/logger.js';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const app = express();

// Behind nginx reverse proxy — trust X-Forwarded-For so rate limiting + IPs work
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());

// CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
app.use(generalRateLimit);

// API Routes
app.use(routes);

// Swagger Documentation
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'BigTrade Investment Platform API',
      version: '1.0.0',
      description: 'Production-ready Investment, ROI, Referral and Multi-Level Income Platform',
    },
    servers: [
      {
        url: `http://localhost:${process.env.PORT || 5000}`,
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: ['./src/routes/*.js'],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    errorCode: 'NOT_FOUND',
  });
});

// Error handling middleware
app.use(errorHandler);

export default app;
