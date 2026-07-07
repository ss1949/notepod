import React, { useRef, useState, useEffect, useMemo, useCallback } from "react";
import { NoteSummary, Folder } from "../../lib/tauri";
import { GraphNode, GraphEdge, buildGraphData } from "../../lib/wikiLinks";

// ---- 常量 ----
const NOTE_COLOR = "#4A90D9";
const JOURNAL_COLOR = "#0EA5E9";
const EDGE_COLOR = "rgba(128,128,128,0.3)";

// ---- 工具函数 ----
function nodeRadius(n: GraphNode): number {
  return 12 + Math.min(n.linkCount || 0, 12) * 2.5;
}

function getDescendantFolderIds(
  folderId: string,
  folders: Folder[]
): string[] {
  const result: string[] = [folderId];
  const children = folders.filter((f) => f.parent_id === folderId);
  for (const child of children) {
    result.push(...getDescendantFolderIds(child.id, folders));
  }
  return result;
}

interface FolderOption {
  id: string;
  name: string;
  depth: number;
}

function buildFolderOptions(folders: Folder[]): FolderOption[] {
  const result: FolderOption[] = [];
  function walk(parentId: string | null, depth: number) {
    const children = folders.filter((f) =>
      parentId === null ? !f.parent_id : f.parent_id === parentId
    );
    children.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    for (const f of children) {
      result.push({ id: f.id, name: f.name, depth });
      walk(f.id, depth + 1);
    }
  }
  walk(null, 0);
  return result;
}

// ---- 类型 ----
type NodeTypeFilter = "all" | "note" | "journal";

interface GraphViewProps {
  notes: NoteSummary[];
  journals?: NoteSummary[];
  folders?: Folder[];
  onNodeClick?: (noteId: string) => void;
  className?: string;
}

interface GraphHeaderProps {
  folders: Folder[];
  folderOptions: { id: string; name: string; depth: number }[];
  folderFilter: string | null;
  typeFilter: NodeTypeFilter;
  nodeCount: number;
  totalCount: number;
  noteCount: number;
  journalCount: number;
  onFolderChange: (folderId: string | null) => void;
  onTypeChange: (type: NodeTypeFilter) => void;
}

// ---- 子组件 ----
const GraphHeader = React.memo(function GraphHeader({
  folders,
  folderOptions,
  folderFilter,
  typeFilter,
  nodeCount,
  totalCount,
  noteCount,
  journalCount,
  onFolderChange,
  onTypeChange,
}: GraphHeaderProps) {
  const [folderOpen, setFolderOpen] = useState(false);
  const currentFolder = folderFilter
    ? folderOptions.find(f => f.id === folderFilter)
    : null;

  return (
    <div className="flex items-start flex-wrap gap-y-2 justify-between px-4 py-2 border-b border-border text-xs">
      <div className="flex items-center gap-3 flex-wrap">
        {folderOptions.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setFolderOpen(!folderOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-border bg-bg-input text-text-primary outline-none text-xs"
            >
              {currentFolder ? (
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: folders.find(f => f.id === folderFilter)?.color }} />
                  <span className="max-w-[80px] truncate">{currentFolder.name}</span>
                </span>
              ) : (
                <span>全部文件夹</span>
              )}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            {folderOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setFolderOpen(false)} />
                <div className="absolute left-0 top-full mt-1 z-50 min-w-40 rounded-lg py-1 shadow-lg max-h-60 overflow-y-auto" style={{ background: "var(--color-bg-primary)", border: "1px solid var(--color-border)" }}>
                  <button
                    onClick={() => { onFolderChange(null); setFolderOpen(false); }}
                    className="flex items-center w-full text-left text-xs px-3 py-2 hover:bg-bg-sidebar-hover text-text-primary"
                  >
                    {!folderFilter && <span className="w-4 mr-1 text-accent">✓</span>}
                    {folderFilter && <span className="w-4 mr-1" />}
                    全部文件夹
                  </button>
                  {folderOptions.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => { onFolderChange(f.id); setFolderOpen(false); }}
                      className="flex items-center w-full text-left text-xs px-3 py-2 hover:bg-bg-sidebar-hover text-text-primary"
                      style={{ paddingLeft: 12 + f.depth * 12 }}
                    >
                      {folderFilter === f.id ? <span className="w-4 mr-1 text-accent">✓</span> : <span className="w-4 mr-1" />}
                      <span className="w-2.5 h-2.5 rounded-sm mr-1.5 shrink-0" style={{ backgroundColor: folders.find(fo => fo.id === f.id)?.color }} />
                      <span className="truncate">{f.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex items-center gap-1 rounded bg-bg-input p-0.5">
          {(["all", "note", "journal"] as NodeTypeFilter[]).map((t) => (
            <button
              key={t}
              onClick={() => onTypeChange(t)}
              className="px-2.5 py-1 rounded text-xs font-medium transition-colors"
              style={{
                background: typeFilter === t ? "var(--color-accent)" : "transparent",
                color: typeFilter === t ? "#fff" : "var(--color-text-secondary)",
              }}
            >
              {t === "all" ? "全部" : t === "note" ? "笔记" : "日志"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-4 text-text-muted flex-wrap">
        <span>当前 {nodeCount} 个节点</span>
        <span className="hidden sm:inline">数据构成：全部 {totalCount}（笔记 {noteCount}，日志 {journalCount}）</span>
      </div>
    </div>
  );
});

// ---- 主组件 ----
export function GraphView({
  notes,
  journals = [],
  folders = [],
  onNodeClick,
  className,
}: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<NodeTypeFilter>("all");
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [graphKey, setGraphKey] = useState(0);

  // 力导向模拟用的可变节点（从 graphData 初始位置开始）
  const [simNodes, setSimNodes] = useState<GraphNode[]>([]);
  const simEpochRef = useRef(0);
  const simNodesRef = useRef<GraphNode[]>([]);
  const dragRef = useRef<string | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; nx: number; ny: number } | null>(null);
  const dragMovedRef = useRef(false);

  // 同步 ref
  useEffect(() => { simNodesRef.current = simNodes; }, [simNodes]);

  // 容器尺寸
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 合并数据
  const allNotes = useMemo(
    () => [...notes, ...journals],
    [notes, journals]
  );

  // 过滤
  const filteredNotes = useMemo(() => {
    let list = allNotes;
    if (typeFilter === "journal") {
      list = list.filter((n) => n.note_type === "daily");
    } else if (typeFilter === "note") {
      list = list.filter((n) => n.note_type !== "daily");
    }
    if (folderFilter) {
      const allowed = new Set(getDescendantFolderIds(folderFilter, folders));
      list = list.filter(
        (n) => n.note_type === "daily" || (n.folder_id && allowed.has(n.folder_id))
      );
    }
    return list;
  }, [allNotes, typeFilter, folderFilter, folders]);

  // 统计
  const typeCounts = useMemo(() => {
    const total = allNotes.length;
    const j = allNotes.filter((n) => n.note_type === "daily").length;
    return { total, notes: total - j, journals: j };
  }, [allNotes]);

  // 图谱数据：每次 filteredNotes 变化时重新计算，带稳定布局
  const graphData = useMemo(() => {
    const raw = buildGraphData(filteredNotes);
    const cx = size.w / 2;
    const cy = size.h / 2;
    const r = Math.min(size.w, size.h) * 0.35;
    raw.nodes.forEach((n, i) => {
      const angle = (i / Math.max(1, raw.nodes.length)) * Math.PI * 2 - Math.PI / 2;
      n.x = cx + Math.cos(angle) * r;
      n.y = cy + Math.sin(angle) * r;
      n.vx = 0;
      n.vy = 0;
    });
    return raw;
  }, [filteredNotes, size.w, size.h]);

  const nodes = simNodes.length > 0 ? simNodes : graphData.nodes;
  const edges = graphData.edges;

  const folderById = useMemo(() => {
    const map = new Map<string, Folder>();
    for (const f of folders) map.set(f.id, f);
    return map;
  }, [folders]);

  const folderOptions = useMemo(() => buildFolderOptions(folders), [folders]);

  const noteById = useMemo(() => {
    const map = new Map<string, NoteSummary>();
    for (const n of allNotes) map.set(n.id, n);
    return map;
  }, [allNotes]);

  // 节点颜色
  const resolveNodeColor = useCallback(
    (nodeId: string) => {
      const note = noteById.get(nodeId);
      if (note?.note_type === "daily") return JOURNAL_COLOR;
      if (note?.folder_id) {
        const f = folderById.get(note.folder_id);
        if (f?.color) return f.color;
      }
      return NOTE_COLOR;
    },
    [noteById, folderById]
  );

  // hover 高亮相关节点
  const connectedIds = useMemo(() => {
    const adj = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!adj.has(e.source)) adj.set(e.source, new Set());
      if (!adj.has(e.target)) adj.set(e.target, new Set());
      adj.get(e.source)!.add(e.target);
      adj.get(e.target)!.add(e.source);
    }
    return adj;
  }, [edges]);

  const isConnected = (a: string, b: string) => {
    if (a === b) return true;
    return connectedIds.get(a)?.has(b) ?? false;
  };

  const getNodeOpacity = (id: string) => {
    if (!hoverId) return 0.85;
    if (id === hoverId) return 1;
    return isConnected(id, hoverId) ? 0.7 : 0.2;
  };

  const getLabelOpacity = (id: string) => {
    if (!hoverId) return 0.8;
    if (id === hoverId) return 1;
    return isConnected(id, hoverId) ? 0.6 : 0.15;
  };

  // 回调
  const handleFolderChange = useCallback((id: string | null) => setFolderFilter(id), []);
  const handleTypeChange = useCallback((t: NodeTypeFilter) => setTypeFilter(t), []);

  // 图谱数据变化时：初始化力导向模拟
  useEffect(() => {
    setGraphKey((k) => k + 1);
    setSimNodes(graphData.nodes.map((n) => ({ ...n })));
    simEpochRef.current++; // 杀死旧的力导向动画
  }, [graphData]);

  // 力导向动画（用 epoch 杜绝旧回调覆盖新数据）
  useEffect(() => {
    const nodesCopy = simNodesRef.current;
    if (nodesCopy.length === 0) return;
    const epoch = simEpochRef.current;
    let raf = 0;

    // 初始化速度
    for (const n of nodesCopy) { n.vx = 0; n.vy = 0; }

    const nodeMap = new Map(nodesCopy.map((n) => [n.id, n]));
    const edgeList = graphData.edges;

    const step = () => {
      if (simEpochRef.current !== epoch) return;
      const cx = size.w / 2;
      const cy = size.h / 2;

      for (let i = 0; i < nodesCopy.length; i++) {
        for (let j = i + 1; j < nodesCopy.length; j++) {
          const a = nodesCopy[i], b = nodesCopy[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = 1800 / (dist * dist);
          const fx = (dx / dist) * force, fy = (dy / dist) * force;
          a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
        }
      }
      for (const e of edgeList) {
        const a = nodeMap.get(e.source), b = nodeMap.get(e.target);
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - 160) * 0.02;
        const fx = (dx / dist) * force, fy = (dy / dist) * force;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
      for (const n of nodesCopy) {
        n.vx += (cx - n.x) * 0.0008;
        n.vy += (cy - n.y) * 0.0008;
      }
      for (const n of nodesCopy) {
        if (dragRef.current === n.id) { n.vx = 0; n.vy = 0; continue; }
        n.vx *= 0.82; n.vy *= 0.82;
        const sp = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
        if (sp > 20) { n.vx = (n.vx / sp) * 20; n.vy = (n.vy / sp) * 20; }
        n.x += n.vx; n.y += n.vy;
        if (n.x < 40) { n.x = 40; n.vx = -n.vx * 0.3; }
        if (n.x > size.w - 40) { n.x = size.w - 40; n.vx = -n.vx * 0.3; }
        if (n.y < 40) { n.y = 40; n.vy = -n.vy * 0.3; }
        if (n.y > size.h - 40) { n.y = size.h - 40; n.vy = -n.vy * 0.3; }
      }
      setSimNodes(nodesCopy.map((n) => ({ ...n })));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [graphKey, size.w, size.h]);

  // 拖动
  const onPointerDown = (e: React.PointerEvent, nodeId: string) => {
    e.stopPropagation();
    dragRef.current = nodeId;
    dragStartRef.current = { x: e.clientX, y: e.clientY, nx: 0, ny: 0 };
    dragMovedRef.current = false;
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragMovedRef.current = true;
    }
    // 拖动只影响视觉，不更新 state（稳定布局，不复杂化）
  };

  const onPointerUp = () => {
    dragRef.current = null;
    dragStartRef.current = null;
  };

  const empty = nodes.length === 0;

  return (
    <div className={`flex flex-col h-full ${className ?? ""}`}>
      <style>{`
        @keyframes graphFadeIn {
          from { opacity: 0; transform: scale(0.92); }
          to   { opacity: 1; transform: scale(1); }
        }
        .graph-canvas { transform-origin: center center; }
      `}</style>
      <GraphHeader
        folders={folders}
        folderOptions={folderOptions}
        folderFilter={folderFilter}
        typeFilter={typeFilter}
        nodeCount={nodes.length}
        totalCount={typeCounts.total}
        noteCount={typeCounts.notes}
        journalCount={typeCounts.journals}
        onFolderChange={handleFolderChange}
        onTypeChange={handleTypeChange}
      />

      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-hidden"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        style={{ cursor: dragRef.current ? "grabbing" : "grab" }}
      >
        {empty ? (
          <div className="w-full h-full flex flex-col items-center justify-center text-text-muted text-sm">
            <div style={{ fontSize: 28, opacity: 0.3, marginBottom: 8 }}>🌐</div>
            <div style={{ fontSize: 12 }}>暂无关系</div>
          </div>
        ) : (
          <svg key={graphKey} width={size.w} height={size.h} className="graph-canvas" style={{ display: "block", animation: "graphFadeIn 0.4s ease both" }}>
            {/* 连线 */}
            {edges.map((e, i) => {
              const a = nodes.find((n) => n.id === e.source);
              const b = nodes.find((n) => n.id === e.target);
              if (!a || !b) return null;
              return (
                <line
                  key={`e-${i}`}
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={EDGE_COLOR}
                  strokeWidth={1}
                />
              );
            })}
            {/* 节点 */}
            {nodes.map((n) => {
              const r = nodeRadius(n);
              const color = resolveNodeColor(n.id);
              const isHov = hoverId === n.id;
              return (
                <g key={n.id} opacity={getNodeOpacity(n.id)}>
                  <circle
                    cx={n.x} cy={n.y} r={r}
                    fill={color}
                    stroke={isHov ? "#fff" : color}
                    strokeWidth={isHov ? 3 : 0}
                    style={{ cursor: "pointer", transition: "opacity 0.2s" }}
                    onPointerDown={(e) => onPointerDown(e, n.id)}
                    onPointerEnter={() => setHoverId(n.id)}
                    onPointerLeave={() => setHoverId(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (dragMovedRef.current) {
                        dragMovedRef.current = false;
                        return;
                      }
                      onNodeClick?.(n.id);
                    }}
                  />
                  <text
                    x={n.x} y={n.y - r - 6}
                    textAnchor="middle"
                    fontSize={12}
                    fill="var(--color-text-primary)"
                    opacity={getLabelOpacity(n.id)}
                    style={{ pointerEvents: "none", userSelect: "none", transition: "opacity 0.2s" }}
                  >
                    {n.label}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}
