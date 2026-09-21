export type LiveTvNavProgram = {
  id?: string;
  title: string;
  startTime: string;
  endTime: string;
  overview?: string;
  thumbnail?: string;
};

export type LiveTvNavEntry = {
  id: string;
  addonId: string;
  name: string;
  logo: string;
  sourceName?: string;
  programs?: LiveTvNavProgram[];
};

type LiveTvNavState = {
  entries: LiveTvNavEntry[];
  index: number;
};

let state: LiveTvNavState = {
  entries: [],
  index: -1,
};

export const setLiveTvNavSnapshot = (
  entries: LiveTvNavEntry[],
  currentId: string,
  currentAddonId: string
) => {
  // V786B_LIVE_TV_NAV_OWNER_ID_DEDUPE
  const valid: LiveTvNavEntry[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const entryId = String(entry?.id || '').trim();
    const entryAddonId = String(entry?.addonId || '').trim();

    if (!entryId || !entryAddonId) continue;

    const identity = `${entryAddonId}:${entryId}`;

    if (seen.has(identity)) continue;
    seen.add(identity);

    valid.push({
      ...entry,
      id: entryId,
      addonId: entryAddonId,
    });
  }

  const id = String(currentId || '').trim();
  const addonId = String(currentAddonId || '').trim();

  state = {
    entries: valid,
    index: valid.findIndex(
      (entry) =>
        entry.id === id &&
        entry.addonId === addonId
    ),
  };
};

export const getLiveTvCurrent = () => {
  if (
    state.index < 0 ||
    state.index >= state.entries.length
  ) return null;

  return {
    entry: state.entries[state.index],
    index: state.index,
  };
};

export const getLiveTvNeighbor = (delta: number) => {
  if (
    state.index < 0 ||
    state.index >= state.entries.length
  ) return null;

  const index = state.index + delta;

  if (
    index < 0 ||
    index >= state.entries.length
  ) return null;

  return {
    entry: state.entries[index],
    index,
  };
};

export const setLiveTvCurrentIndex = (index: number) => {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= state.entries.length
  ) return false;

  state.index = index;
  return true;
};

// V785L5_LIVE_TV_NAV
