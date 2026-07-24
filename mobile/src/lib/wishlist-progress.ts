export const sumAmounts = (amounts: number[]) =>
  amounts.reduce((total, amount) => total + amount, 0);

export const getWishlistProgress = (
  savedAmount: number,
  targetAmount: number,
) => {
  const percentage = Math.round((savedAmount / targetAmount) * 100);
  return {
    percentage,
    barPercentage: Math.min(percentage, 100),
  };
};
