import { z } from 'zod';

export const setGlobalRoiSchema = z.object({
  roiPercent: z.number().min(6, 'ROI must be at least 6%').max(12, 'ROI must not exceed 12%'),
  period: z.string().regex(/^\d{4}-\d{2}$/, 'Period must be in YYYY-MM format'),
});

export const setUserRoiSchema = z.object({
  roiPercent: z.number().min(6, 'ROI must be at least 6%').max(12, 'ROI must not exceed 12%'),
  period: z.string().regex(/^\d{4}-\d{2}$/, 'Period must be in YYYY-MM format'),
});

export const setInvestmentRoiSchema = z.object({
  roiPercent: z.number().min(6, 'ROI must be at least 6%').max(12, 'ROI must not exceed 12%'),
  period: z.string().regex(/^\d{4}-\d{2}$/, 'Period must be in YYYY-MM format'),
});
