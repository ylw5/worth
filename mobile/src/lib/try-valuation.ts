export async function tryValuation(run: () => Promise<void>) {
  try {
    await run();
    return true;
  } catch {
    return false;
  }
}
