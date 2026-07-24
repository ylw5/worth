export function compareReplacement(
  targetPrice: number | null,
  currentValue: number | null,
  futureValue: number | null,
) {
  if (targetPrice == null || currentValue == null || futureValue == null) {
    return null;
  }
  const changeNowCash = targetPrice - currentValue;
  const changeLaterCash = targetPrice - futureValue;
  return {
    changeNowCash,
    changeLaterCash,
    waitingCashDifference: changeLaterCash - changeNowCash,
  };
}
