import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, put } from '../api';
import { useApp, useLoad } from '../state';
import { ErrorBox, Loading, Sheet, Bar } from '../components/ui';
import { VerifyTag } from '../components/PlanView';
import { IFit, IMinus, IPlus, ILink, ISearch } from '../components/Icons';

type MNode = {
  id: string; parent_id: string | null; stage_id: string | null; kind: 'root' | 'trunk' | 'branch' | 'leaf'; title: string; summary: string | null; status: string; mastery: number;
  order_idx: number; pos_x: number | null; pos_y: number | null; lessons: number; read: number; next_lesson: string | null; sources: { id: string; title: string; url: string | null; verification_status: string }[];
};
type MapData = { model: 'tree' | 'network'; title: string; nodes: MNode[]; relations: { id: string; from_node: string; to_node: string; type: string; note: string }[]; stages: { id: string; idx: number; title: string }[] };

const R = { root: 17, trunk: 15, branch: 12, leaf: 9 } as const;
const REL_COLOR: Record<string, string> = { prerequisite: '#7c8885', historical: '#8a6d3b', conceptual: '#1f6f66', influence: '#4e6fae', disagreement: '#a5402d', application: '#6b8e23' };
const GAP_X = 150;
const GAP_Y = 120;

/** Two short lines at most, so neighbouring labels don't collide. */
function wrapLabel(title: string, max = 16): string[] {
  const words = title.split(/\s+/);
  const lines: string[] = [''];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if ((cur + ' ' + w).trim().length <= max || !cur) lines[lines.length - 1] = (cur + ' ' + w).trim();
    else if (lines.length < 2) lines.push(w);
    else {
      lines[1] = lines[1] + '…';
      break;
    }
  }
  return lines.map((l) => (l.length > max + 4 ? l.slice(0, max + 2) + '…' : l));
}

/** Interactive knowledge tree: roots at the bottom, growing upward; fruits = mastered topics. */
export default function MapPage() {
  const { id } = useParams();
  const { t, locale } = useApp();
  const nav = useNavigate();
  const { data, error, reload, setData } = useLoad(() => api<MapData>(`/journeys/${id}/map`), [id]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showRel, setShowRel] = useState<boolean | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<MNode | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const svgRef = useRef<SVGSVGElement>(null);
  const initialised = useRef(false);

  const children = useMemo(() => {
    const m = new Map<string | null, MNode[]>();
    const ids = new Set((data?.nodes ?? []).map((n) => n.id));
    for (const n of data?.nodes ?? []) {
      const p = n.parent_id && ids.has(n.parent_id) ? n.parent_id : null;
      m.set(p, [...(m.get(p) ?? []), n]);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.order_idx - b.order_idx);
    return m;
  }, [data]);

  // Start calm: show the top levels, collapse deeper branches.
  useEffect(() => {
    if (!data || initialised.current) return;
    initialised.current = true;
    const c = new Set<string>();
    const walk = (pid: string | null, depth: number) => {
      for (const n of children.get(pid) ?? []) {
        if (depth >= 2 && (children.get(n.id)?.length ?? 0) > 0) c.add(n.id);
        walk(n.id, depth + 1);
      }
    };
    walk(null, 0);
    setCollapsed(c);
  }, [data, children]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2 || !data) return new Set<string>();
    return new Set(data.nodes.filter((n) => n.title.toLowerCase().includes(q) || (n.summary ?? '').toLowerCase().includes(q)).map((n) => n.id));
  }, [query, data]);

  // Expand ancestors of search hits.
  useEffect(() => {
    if (!matches.size || !data) return;
    const byId = new Map(data.nodes.map((n) => [n.id, n]));
    setCollapsed((c) => {
      const next = new Set(c);
      for (const m of matches) {
        let p = byId.get(m)?.parent_id;
        while (p) {
          next.delete(p);
          p = byId.get(p)?.parent_id ?? null;
        }
      }
      return next;
    });
  }, [matches, data]);

  // Tidy layout (leaves get slots, parents centre over children). Depth grows upward.
  const layout = useMemo(() => {
    const pos = new Map<string, { x: number; y: number; depth: number; hidden: number }>();
    let slot = 0;
    let maxDepth = 0;
    const countHidden = (nid: string): number => (children.get(nid) ?? []).reduce((a, c) => a + 1 + countHidden(c.id), 0);
    const place = (n: MNode, depth: number): number => {
      maxDepth = Math.max(maxDepth, depth);
      const kids = collapsed.has(n.id) ? [] : children.get(n.id) ?? [];
      let x: number;
      if (!kids.length) x = slot++ * GAP_X;
      else {
        const xs = kids.map((k) => place(k, depth + 1));
        x = (Math.min(...xs) + Math.max(...xs)) / 2;
      }
      pos.set(n.id, { x, y: 0, depth, hidden: collapsed.has(n.id) ? countHidden(n.id) : 0 });
      return x;
    };
    for (const r of children.get(null) ?? []) place(r, 0);
    const width = Math.max(1, slot - 1) * GAP_X;
    for (const [nid, p] of pos) {
      p.y = (maxDepth - p.depth) * GAP_Y;
      if (locale === 'ar') p.x = width - p.x;
      const n = data?.nodes.find((x) => x.id === nid);
      if (n?.pos_x != null && n.pos_y != null) {
        p.x = n.pos_x;
        p.y = n.pos_y;
      }
    }
    return { pos, width, height: maxDepth * GAP_Y };
  }, [children, collapsed, data, locale]);

  const fit = () => {
    const el = svgRef.current;
    if (!el || !layout.pos.size) return;
    const xs = [...layout.pos.values()].map((p) => p.x);
    const ys = [...layout.pos.values()].map((p) => p.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs) - 90, Math.max(...xs) + 90, Math.min(...ys) - 60, Math.max(...ys) + 70];
    const { width, height } = el.getBoundingClientRect();
    const k = Math.min(1.4, Math.min(width / (maxX - minX), height / (maxY - minY)));
    setView({ k, x: (width - (maxX - minX) * k) / 2 - minX * k, y: (height - (maxY - minY) * k) / 2 - minY * k });
  };
  useEffect(() => {
    fit();
  }, [layout.pos.size]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pan / zoom / drag with pointer events (mouse, touch, pen).
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ kind: 'pan' | 'node'; id?: string; sx: number; sy: number; vx: number; vy: number; nx?: number; ny?: number; moved: boolean; pinch?: number } | null>(null);
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);

  const zoomAt = (factor: number, cx: number, cy: number) =>
    setView((v) => {
      const k = Math.max(0.25, Math.min(3, v.k * factor));
      return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
    });
  const onWheel = (e: React.WheelEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
  };
  const onDown = (e: React.PointerEvent, nodeId?: string) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      drag.current = { kind: 'pan', sx: 0, sy: 0, vx: view.x, vy: view.y, moved: true, pinch: Math.hypot(a.x - b.x, a.y - b.y) };
      return;
    }
    const p = nodeId ? layout.pos.get(nodeId) : undefined;
    drag.current = { kind: nodeId ? 'node' : 'pan', id: nodeId, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, nx: p?.x, ny: p?.y, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = drag.current;
    if (!d) return;
    if (d.pinch && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const r = svgRef.current!.getBoundingClientRect();
      zoomAt(dist / d.pinch, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      d.pinch = dist;
      return;
    }
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 5) d.moved = true;
    if (!d.moved) return;
    if (d.kind === 'pan') setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
    else if (d.id) setDragPos({ id: d.id, x: d.nx! + dx / view.k, y: d.ny! + dy / view.k });
  };
  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    if (!d || pointers.current.size > 0) return;
    drag.current = null;
    if (d.kind === 'node' && d.id) {
      if (!d.moved) setSelected(data!.nodes.find((n) => n.id === d.id) ?? null);
      else if (dragPos) {
        const { x, y } = dragPos;
        setData({ ...data!, nodes: data!.nodes.map((n) => (n.id === d.id ? { ...n, pos_x: x, pos_y: y } : n)) });
        setDragPos(null);
        void put(`/journeys/${id}/map/nodes/${d.id}`, { pos_x: x, pos_y: y }).catch(() => undefined);
      }
    }
  };

  if (error) return <ErrorBox code={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const relOn = showRel ?? data.model === 'network';
  const P = (nid: string) => (dragPos?.id === nid ? dragPos : layout.pos.get(nid));
  const visible = data.nodes.filter((n) => layout.pos.has(n.id));
  const kindLabel = { root: t('roots'), trunk: t('trunk'), branch: t('branches'), leaf: t('leaves') };
  const statusLabel = (s: string) => ({ done: t('done'), current: t('current'), upcoming: t('upcoming'), skipped: t('skipped') }[s] ?? s);
  const toggle = (nid: string) => setCollapsed((c) => { const n = new Set(c); if (n.has(nid)) n.delete(nid); else n.add(nid); return n; });

  return (
    <div>
      <div className="spread" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>{t('map_title')}</h1>
        <label className="row card" style={{ padding: '2px 10px', margin: 0, flex: '1 1 220px', maxWidth: 360 }}>
          <ISearch style={{ width: 18, color: 'var(--ink-3)' }} />
          <input className="input" style={{ border: 0, minHeight: 38, padding: 4 }} placeholder={t('map_search')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('map_search')} />
        </label>
      </div>
      <div className="map-wrap">
        <svg ref={svgRef} onWheel={onWheel} onPointerDown={(e) => onDown(e)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} role="img" aria-label={t('map_title')}>
          <defs>
            <radialGradient id="fruit" cx="35%" cy="35%"><stop offset="0%" stopColor="#f3d98f" /><stop offset="100%" stopColor="#b8913a" /></radialGradient>
          </defs>
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {/* ground line under the roots */}
            <line x1={-200} x2={layout.width + 200} y1={layout.height + 40} y2={layout.height + 40} stroke="var(--line)" strokeWidth={2} strokeDasharray="2 6" />
            {visible.map((n) => {
              const parent = n.parent_id ? P(n.parent_id) : null;
              const me = P(n.id)!;
              if (!parent) return null;
              const midY = (me.y + parent.y) / 2;
              return <path key={`e${n.id}`} d={`M${parent.x},${parent.y} C${parent.x},${midY} ${me.x},${midY} ${me.x},${me.y}`} fill="none" stroke={n.status === 'done' ? 'var(--gold)' : 'var(--primary)'} strokeOpacity={n.status === 'upcoming' ? 0.35 : 0.7} strokeWidth={n.kind === 'trunk' ? 5 : n.kind === 'branch' ? 3 : 2} strokeLinecap="round" />;
            })}
            {relOn && data.relations.map((r) => {
              const a = P(r.from_node);
              const b = P(r.to_node);
              if (!a || !b) return null;
              return <path key={r.id} d={`M${a.x},${a.y} Q${(a.x + b.x) / 2},${Math.min(a.y, b.y) - 50} ${b.x},${b.y}`} fill="none" stroke={REL_COLOR[r.type] ?? 'gray'} strokeWidth={1.6} strokeDasharray="5 5" opacity={0.85}><title>{t(`rel_${r.type}` as any)}: {r.note}</title></path>;
            })}
            {visible.map((n) => {
              const p = P(n.id)!;
              const r = R[n.kind] ?? 10;
              const hit = matches.has(n.id);
              const done = n.status === 'done';
              const hidden = layout.pos.get(n.id)?.hidden ?? 0;
              return (
                <g key={n.id} transform={`translate(${p.x},${p.y})`} style={{ cursor: 'pointer' }} onPointerDown={(e) => onDown(e, n.id)} tabIndex={0} role="button" aria-label={`${n.title} — ${statusLabel(n.status)}`} onKeyDown={(e) => e.key === 'Enter' && setSelected(n)}>
                  {hit && <circle r={r + 9} fill="none" stroke="var(--gold)" strokeWidth={3} />}
                  {n.kind === 'leaf' && !done ? (
                    <path d={`M0,${-r} C${r},${-r / 2} ${r},${r / 2} 0,${r} C${-r},${r / 2} ${-r},${-r / 2} 0,${-r}Z`} fill={n.status === 'current' ? 'var(--primary)' : 'var(--primary-soft)'} stroke="var(--primary)" strokeWidth={1.5} opacity={n.status === 'skipped' ? 0.35 : 1} />
                  ) : (
                    <circle r={r} fill={done ? 'url(#fruit)' : n.status === 'current' ? 'var(--primary)' : 'var(--surface)'} stroke={done ? 'var(--gold)' : 'var(--primary)'} strokeWidth={2} opacity={n.status === 'skipped' ? 0.35 : 1} />
                  )}
                  {n.lessons > 0 && n.read > 0 && !done && (
                    <circle r={r + 4} fill="none" stroke="var(--gold)" strokeWidth={3} strokeDasharray={`${(n.read / n.lessons) * 2 * Math.PI * (r + 4)} 999`} transform="rotate(-90)" />
                  )}
                  {hidden > 0 && (
                    <g transform={`translate(${r},${-r})`}><circle r={9} fill="var(--gold)" /><text textAnchor="middle" dy="4" fontSize="10" fill="#fff" fontWeight={700}>+{hidden}</text></g>
                  )}
                  <text className="node-label" textAnchor="middle" y={r + 17} fontWeight={n.kind === 'leaf' ? 400 : 700}>
                    {wrapLabel(n.title).map((line, i) => <tspan key={i} x={0} dy={i ? 16 : 0}>{line}</tspan>)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
        <div className="map-tools">
          <button className="icon-btn" onClick={() => zoomAt(1.2, svgRef.current!.clientWidth / 2, svgRef.current!.clientHeight / 2)} aria-label={t('zoom_in')}><IPlus /></button>
          <button className="icon-btn" onClick={() => zoomAt(1 / 1.2, svgRef.current!.clientWidth / 2, svgRef.current!.clientHeight / 2)} aria-label={t('zoom_out')}><IMinus /></button>
          <button className="icon-btn" onClick={fit} aria-label={t('fit')} title={t('fit')}><IFit /></button>
          <button className={`icon-btn${relOn ? ' active' : ''}`} onClick={() => setShowRel(!relOn)} aria-pressed={relOn} aria-label={t('relations')} title={t('relations')}><ILink /></button>
        </div>
        <div className="map-legend">
          <span><i style={{ background: 'var(--surface)', border: '2px solid var(--primary)' }} />{t('roots')}/{t('branches')}</span>
          <span><i style={{ background: 'var(--primary-soft)', border: '1px solid var(--primary)', borderRadius: '50% 0' }} />{t('leaves')}</span>
          <span><i style={{ background: 'var(--primary)' }} />{t('current')}</span>
          <span><i style={{ background: 'var(--gold)' }} />{t('fruits')}</span>
        </div>
      </div>

      <Sheet open={!!selected} onClose={() => setSelected(null)} label={selected?.title ?? ''}>
        {selected && (
          <div>
            <div className="row wrap" style={{ gap: 6 }}>
              <span className="tag">{kindLabel[selected.kind]}</span>
              <span className={`tag ${selected.status === 'done' ? 'gold' : selected.status === 'current' ? 'ok' : ''}`}>{statusLabel(selected.status)}</span>
              {data.stages.find((s) => s.id === selected.stage_id) && <span className="faint">{data.stages.find((s) => s.id === selected.stage_id)!.title}</span>}
            </div>
            <h2 style={{ marginTop: 8 }}>{selected.title}</h2>
            {selected.summary && <p className="muted">{selected.summary}</p>}
            {selected.lessons > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div className="faint">{t('node_lessons', { r: selected.read, n: selected.lessons })}</div>
                <Bar percent={Math.round((selected.read / selected.lessons) * 100)} />
              </div>
            )}
            {data.relations.filter((r) => r.from_node === selected.id || r.to_node === selected.id).map((r) => {
              const other = data.nodes.find((n) => n.id === (r.from_node === selected.id ? r.to_node : r.from_node));
              return <p key={r.id} style={{ margin: '4px 0' }}><span className="tag" style={{ color: REL_COLOR[r.type] }}>{t(`rel_${r.type}` as any)}</span> {other?.title} — <span className="faint">{r.note}</span></p>;
            })}
            {selected.sources.length > 0 && (
              <>
                <h3 style={{ marginTop: 12 }}>{t('sources')}</h3>
                {selected.sources.map((s) => (
                  <div key={s.id} className="row wrap" style={{ marginBottom: 6 }}>
                    {s.url ? <a href={s.url} target="_blank" rel="noreferrer" dir="auto">{s.title}</a> : <span dir="auto">{s.title}</span>} <VerifyTag status={s.verification_status} />
                  </div>
                ))}
              </>
            )}
            <div className="row wrap" style={{ marginTop: 12 }}>
              {selected.next_lesson && <button className="btn primary" onClick={() => nav(`/j/${id}/lesson/${selected.next_lesson}`)}>{t('open_node_lesson')}</button>}
              {(children.get(selected.id)?.length ?? 0) > 0 && <button className="btn" onClick={() => toggle(selected.id)}>{collapsed.has(selected.id) ? t('expand') : t('collapse')}</button>}
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
