/// 日期工具函数

/** 获取今天 00:00:00 的 Unix 毫秒时间戳 */
export function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 获取今天 23:59:59 的 Unix 毫秒时间戳 */
export function endOfToday(): number {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** 获取本周一 00:00:00 */
export function startOfWeek(): number {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // 周一为第一天
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 获取本周日 23:59:59 */
export function endOfWeek(): number {
  const start = startOfWeek();
  return start + 7 * 24 * 60 * 60 * 1000 - 1;
}

/** 获取本月1日 00:00:00 */
export function startOfMonth(): number {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 获取本月最后一天 23:59:59 */
export function endOfMonth(): number {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 0);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** 获取上个月1日 00:00:00 */
export function startOfLastMonth(): number {
  const d = new Date();
  d.setMonth(d.getMonth() - 1, 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 获取上个月最后一天 23:59:59 */
export function endOfLastMonth(): number {
  const d = new Date();
  d.setDate(0);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** 格式化时间戳为 yyyy-MM-dd HH:mm */
export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const HH = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${MM}-${dd} ${HH}:${mm}`;
}

/** 格式化时间戳为 yyyy-MM-dd */
export function formatDate(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${MM}-${dd}`;
}

/** 优先级中文映射 */
export function priorityLabel(p: string): string {
  switch (p) {
    case "high": return "高";
    case "low": return "低";
    default: return "中";
  }
}

/** 优先级颜色 */
export function priorityColor(p: string): string {
  switch (p) {
    case "high": return "#e74c3c";
    case "low": return "#95a5a6";
    default: return "#f39c12";
  }
}

/** 状态中文映射 */
export function statusLabel(s: string): string {
  return s === "done" ? "已办" : "待办";
}

/** 是否逾期（截止日期早于今天，且状态不是 done） */
export function isOverdue(dueDate: number, status: string): boolean {
  if (status === "done") return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return dueDate < today.getTime();
}

/** 友好的截止日期格式化 */
export function formatDueDate(dueDate: number): string {
  const d = new Date(dueDate);
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));

  const yyyy = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");

  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "明天";
  if (diffDays === -1) return "昨天";
  if (diffDays > 1 && diffDays <= 7) return `${diffDays}天后`;
  if (diffDays < -1 && diffDays >= -7) return `${-diffDays}天前`;
  if (yyyy === today.getFullYear()) return `${MM}-${dd}`;
  return `${yyyy}-${MM}-${dd}`;
}
