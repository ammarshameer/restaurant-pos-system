/**
 * Utility functions for formatting currency and numbers in PKR (Pakistani Rupee)
 */

export const formatPKR = (amount: number | string | undefined | null): string => {
  const num = Number(amount) || 0;
  return `PKR ${num.toLocaleString('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

export const formatNumber = (num: number | string | undefined | null): string => {
  const n = Number(num) || 0;
  return n.toLocaleString('en-PK');
};

export default formatPKR;
