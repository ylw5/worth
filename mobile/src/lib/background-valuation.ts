import { useSyncExternalStore } from 'react';

import { estimateAsset } from '@/lib/api';
import { recordValuation } from '@/lib/assets';
import type { AssetInput, AssetWriteInput } from '@/types/domain';

type EstimateInput = AssetInput | AssetWriteInput;

const emptyIds: ReadonlySet<string> = new Set();
let valuingIds: ReadonlySet<string> = emptyIds;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return valuingIds;
}

function getServerSnapshot() {
  return emptyIds;
}

function markValuing(assetId: string) {
  if (valuingIds.has(assetId)) return false;
  const next = new Set(valuingIds);
  next.add(assetId);
  valuingIds = next;
  emit();
  return true;
}

function clearValuing(assetId: string) {
  if (!valuingIds.has(assetId)) return;
  const next = new Set(valuingIds);
  next.delete(assetId);
  valuingIds = next.size ? next : emptyIds;
  emit();
}

export function useIsValuing(assetId: string | undefined) {
  return useSyncExternalStore(
    subscribe,
    () => (assetId ? valuingIds.has(assetId) : false),
    () => false,
  );
}

export function useValuingAssetIds() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function startBackgroundValuation(
  assetId: string,
  input: EstimateInput,
  onSettled?: () => unknown,
) {
  if (!markValuing(assetId)) return;

  void (async () => {
    try {
      const valuation = await estimateAsset(input);
      await recordValuation(assetId, valuation);
    } catch {
      // Asset remains valid without a first valuation.
    } finally {
      clearValuing(assetId);
      await onSettled?.();
    }
  })();
}
