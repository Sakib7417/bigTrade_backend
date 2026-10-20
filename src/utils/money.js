import { Prisma } from '@prisma/client';

const Decimal = Prisma.Decimal;

// Always coerce money to Decimal - never do float math on raw numbers
export const toDecimal = (value) => {
  if (value instanceof Decimal) return value;
  return new Decimal(value);
};

export const CURRENCY_PRECISION = 2;

// Round to currency precision (2 decimal places, half-up)
export const roundMoney = (value) => {
  return toDecimal(value).toDecimalPlaces(CURRENCY_PRECISION, Decimal.ROUND_HALF_UP);
};

export { Decimal };
