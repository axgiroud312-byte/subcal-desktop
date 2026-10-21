import { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutDashboard, Search, CornerDownLeft } from 'lucide-react';
import type { Snapshot } from '../../shared/types';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';

export type SearchTarget =
  | { kind: 'page'; route: string; label: string; hint: string }
  | { kind: 'subscription'; id: string; label: string; hint: string };

export function SearchDialog({
  open,
  snapshot,
  pages,
  onClose,
  onPick,
}: {
  open: boolean;
  snapshot: Snapshot;
  pages: { route: string; label: string; hint: string }[];
  onClose: () => void;
  onPick: (target: SearchTarget) => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      window.setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const results = useMemo<SearchTarget[]>(() => {
    const q = query.trim().toLowerCase();
    const pageHits: SearchTarget[] = pages
      .filter((p) => !q || `${p.label} ${p.hint}`.toLowerCase().includes(q))
      .map((p) => ({ kind: 'page', route: p.route, label: p.label, hint: p.hint }));
    const subHits: SearchTarget[] = snapshot.subscriptions
      .filter((s) => {
        if (!q) return true;
        return [s.product, s.brand, s.account, s.plan.value ?? '', s.category ?? '', s.notes]
          .join(' ')
          .toLowerCase()
          .includes(q);
      })
      .slice(0, q ? 8 : 5)
      .map((s) => ({
        kind: 'subscription',
        id: s.id,
        label: s.product,
        hint: [s.account, s.plan.value, s.category].filter(Boolean).join(' · ') || '订阅记录',
      }));
    return [...pageHits, ...subHits];
  }, [pages, query, snapshot.subscriptions]);

  const pick = (target: SearchTarget | undefined) => {
    if (!target) return;
    onPick(target);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sc-ui" showCloseButton={false} data-testid="global-search">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-extrabold">
            <Search className="size-5" /> 搜索订阅、页面
          </DialogTitle>
          <DialogDescription>↑↓ 选择，Enter 打开。</DialogDescription>
        </DialogHeader>
        <input
          ref={inputRef}
          className="sc-input"
          value={query}
          placeholder="搜索订阅或页面"
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); pick(results[active]); }
          }}
          aria-label="搜索"
        />
        <div className="max-h-72 overflow-y-auto" role="listbox" aria-label="搜索结果">
          {results.length === 0 ? (
            <p className="m-0 py-6 text-center text-sm text-(--sc-muted)">没有匹配的记录。可以换个关键词，或先添加订阅。</p>
          ) : (
            results.map((item, index) => (
              <button
                key={`${item.kind}:${item.kind === 'page' ? item.route : item.id}`}
                type="button"
                role="option"
                aria-selected={index === active}
                className={`flex w-full items-center gap-3 rounded-(--sc-radius-sm) px-3 py-2.5 text-left ${index === active ? 'bg-(--sc-accent-soft)' : ''}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(item)}
              >
                {item.kind === 'page' ? <LayoutDashboard className="size-4 text-(--sc-muted)" /> : <Search className="size-4 text-(--sc-muted)" />}
                <span className="flex min-w-0 flex-1 flex-col">
                  <strong className="truncate text-sm font-extrabold">{item.label}</strong>
                  <small className="truncate text-xs text-(--sc-muted)">{item.hint}</small>
                </span>
                {index === active ? <CornerDownLeft className="size-3.5 text-(--sc-muted)" /> : null}
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
