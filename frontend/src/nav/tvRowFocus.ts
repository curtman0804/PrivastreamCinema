import { findNodeHandle } from 'react-native';

type Entry = {
  tag: number;
  ref: any;
};

const rows = new Map<number, Map<number, Entry>>();

function apply(entry: Entry | undefined, up: Entry | undefined, down: Entry | undefined) {
  if (!entry?.ref || !entry.tag) return;

  try {
    entry.ref.setNativeProps({
      nextFocusUp: up?.tag || undefined,
      nextFocusDown: down?.tag || undefined,
    });
  } catch (_) {}
}

export function registerTVRowCard(
  row: number,
  column: number,
  ref: any,
) {
  if (row == null || column == null || !ref) return;

  let rowMap = rows.get(row);
  if (!rowMap) {
    rowMap = new Map<number, Entry>();
    rows.set(row, rowMap);
  }

  let tag = 0;

  try {
    const t = findNodeHandle(ref);
    if (typeof t === 'number' && t > 0) tag = t;
  } catch (_) {}

  if (!tag && ref?._nativeTag > 0) tag = ref._nativeTag;
  if (!tag && ref?.__nativeTag > 0) tag = ref.__nativeTag;

  if (!tag) return;

  const entry = { tag, ref };
  rowMap.set(column, entry);

  const up = rows.get(row - 1)?.get(column);
  const down = rows.get(row + 1)?.get(column);

  apply(entry, up, down);

  if (up) {
    apply(up, undefined, entry);
  }

  if (down) {
    apply(down, entry, undefined);
  }

  console.log(
    '[TV_ROW_FOCUS] registered row=' + row +
    ' col=' + column +
    ' tag=' + tag +
    ' up=' + (up?.tag || 0) +
    ' down=' + (down?.tag || 0)
  );
}

export function unregisterTVRowCard(
  row: number,
  column: number,
  ref?: any,
) {
  const rowMap = rows.get(row);
  if (!rowMap) return;

  const current = rowMap.get(column);

  if (!current || !ref || current.ref === ref) {
    rowMap.delete(column);
  }

  if (rowMap.size === 0) rows.delete(row);

  const up = rows.get(row - 1)?.get(column);
  const down = rows.get(row + 1)?.get(column);

  if (up) apply(up, undefined, down);
  if (down) apply(down, up, undefined);
}
