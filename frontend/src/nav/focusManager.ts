/* V601_STREMIO_FOCUS - weighted-geometric D-pad neighbour resolution, ported
   from Stremio (distance = primary + secondary * 3). Pure math; applied to
   Android via setNativeProps by the caller. All rects are window coords. */
type Rect = { x: number; y: number; w: number; h: number };
type Entry = { tag: number; rect: Rect };
const _entries = new Map<string, Entry>();
export function focusUpsert(id: string | undefined | null, tag: number | undefined | null, rect: Rect | undefined | null): void {
  if (!id || !tag || tag <= 0 || !rect || !rect.w || !rect.h) return;
  _entries.set(String(id), { tag, rect });
}
export function focusRemove(id: string | undefined | null): void {
  if (!id) return;
  _entries.delete(String(id));
}
export type Neighbors = { up?: number; down?: number; left?: number; right?: number };
export function focusResolveNeighbors(id: string | undefined | null): Neighbors {
  if (!id) return {};
  const self = _entries.get(String(id));
  if (!self) return {};
  const cx = self.rect.x + self.rect.w / 2;
  const cy = self.rect.y + self.rect.h / 2;
  const best: Record<'up' | 'down' | 'left' | 'right', { tag: number; dist: number } | undefined> = {
    up: undefined, down: undefined, left: undefined, right: undefined,
  };
  _entries.forEach((e, eid) => {
    if (eid === String(id)) return;
    const ex = e.rect.x + e.rect.w / 2;
    const ey = e.rect.y + e.rect.h / 2;
    const dx = ex - cx;
    const dy = ey - cy;
    const pick = (dir: 'up' | 'down' | 'left' | 'right', ok: boolean, primary: number, secondary: number) => {
      if (!ok) return;
      const dist = Math.abs(primary) + Math.abs(secondary) * 3;
      const cur = best[dir];
      if (!cur || dist < cur.dist) best[dir] = { tag: e.tag, dist };
    };
    pick('up', dy < 0, dy, dx);
    pick('down', dy > 0, dy, dx);
    pick('left', dx < 0, dx, dy);
    pick('right', dx > 0, dx, dy);
  });
  return { up: best.up?.tag, down: best.down?.tag, left: best.left?.tag, right: best.right?.tag };
}
export function focusClear(): void { _entries.clear(); }