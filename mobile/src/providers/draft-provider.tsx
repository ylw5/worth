import { createContext, use, useState } from 'react';

import type { AssetInput } from '@/types/domain';

export type AssetDraft = {
  localUri: string;
  photoPath: string;
  recognition: AssetInput;
};

type DraftState = {
  draft: AssetDraft | null;
  setDraft: (draft: AssetDraft | null) => void;
};

const DraftContext = createContext<DraftState>({
  draft: null,
  setDraft: () => undefined,
});

export function DraftProvider({ children }: { children: React.ReactNode }) {
  const [draft, setDraft] = useState<AssetDraft | null>(null);
  return <DraftContext value={{ draft, setDraft }}>{children}</DraftContext>;
}

export const useDraft = () => use(DraftContext);
