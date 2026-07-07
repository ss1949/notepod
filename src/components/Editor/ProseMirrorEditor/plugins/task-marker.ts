import { Plugin, PluginKey } from 'prosemirror-state';

export const TaskMarkerPluginKey = new PluginKey('taskMarker');

const TASK_MARKERS = ['TODO', 'DOING', 'DONE', 'LATER', 'NOW', 'WAITING', 'CANCELLED'] as const;
type TaskMarker = (typeof TASK_MARKERS)[number];

function isTaskMarker(value: string): value is TaskMarker {
  return (TASK_MARKERS as readonly string[]).includes(value);
}

function formatTimestamp(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}秒`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}分${seconds}秒` : `${minutes}分`;
  }

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) {
    if (mins === 0) return `${hours}小时`;
    return `${hours}小时${mins}分`;
  }

  const days = Math.floor(hours / 24);
  const hrs = hours % 24;
  if (days < 7) {
    if (hrs === 0) return `${days}天`;
    return `${days}天${hrs}小时`;
  }

  const weeks = Math.floor(days / 7);
  const ds = days % 7;
  if (ds === 0) return `${weeks}周`;
  return `${weeks}周${ds}天`;
}

function getNextTaskMarker(marker: TaskMarker): TaskMarker {
  switch (marker) {
    case 'TODO':
      return 'DOING';
    case 'DOING':
      return 'DONE';
    case 'DONE':
      return 'TODO';
    case 'LATER':
      return 'NOW';
    case 'NOW':
      return 'DOING';
    case 'WAITING':
      return 'DOING';
    case 'CANCELLED':
      return 'TODO';
    default:
      return 'TODO';
  }
}

export function TaskMarkerPlugin(): Plugin {
  return new Plugin({
    key: TaskMarkerPluginKey,
    props: {
      handleClick(view, pos, event) {
        const target = event.target as HTMLElement;
        if (!target.classList.contains('task-marker')) return false;

        event.preventDefault();
        event.stopPropagation();

        const $pos = view.state.doc.resolve(pos);
        let taskPos = -1;
        for (let depth = $pos.depth; depth > 0; depth--) {
          const node = $pos.node(depth);
          if (node.type.name === 'task') {
            taskPos = $pos.before(depth);
            break;
          }
        }

        if (taskPos < 0) return true;

        const node = view.state.doc.nodeAt(taskPos);
        if (!node || !isTaskMarker(node.attrs.marker)) return true;
        if (node.attrs.marker === 'DONE' || node.attrs.marker === 'CANCELLED') return true;

        const nextMarker = getNextTaskMarker(node.attrs.marker);
        const now = formatTimestamp();
        const attrs: Record<string, any> = { ...node.attrs, marker: nextMarker };

        if (nextMarker === 'DOING' || nextMarker === 'NOW') {
          attrs.startedAt = attrs.startedAt || now;
          attrs.finishedAt = null;
          attrs.elapsed = null;
        } else if (nextMarker === 'DONE') {
          attrs.finishedAt = now;
          if (attrs.startedAt) {
            const start = new Date(attrs.startedAt).getTime();
            const end = new Date(now).getTime();
            attrs.elapsed = formatDuration(end - start);
          }
        } else {
          attrs.startedAt = null;
          attrs.finishedAt = null;
          attrs.elapsed = null;
        }

        const tr = view.state.tr.setNodeMarkup(taskPos, null, attrs);
        view.dispatch(tr);
        return true;
      },
    },
  });
}
