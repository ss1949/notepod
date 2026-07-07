import { useState, useEffect } from "react";
import { api, ActivityDay } from "../../lib/tauri";

interface HeatmapData {
  [date: string]: number;
}

export function ActivityHeatmap() {
  const [data, setData] = useState<HeatmapData>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadHeatmap();
  }, []);

  const loadHeatmap = async () => {
    try {
      const days = await api.getActivityHeatmap(180); // 最近180天
      const map: HeatmapData = {};
      for (const d of days) {
        map[d.date] = (map[d.date] || 0) + d.count;
      }
      setData(map);
    } catch (e) {
      console.error("Failed to load heatmap:", e);
    } finally {
      setLoading(false);
    }
  };

  // 生成最近16周的日期网格
  const generateGrid = () => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const grid: { date: string; count: number }[][] = [];

    // 从今天往前推16周
    for (let week = 15; week >= 0; week--) {
      const weekData: { date: string; count: number }[] = [];
      for (let day = 0; day < 7; day++) {
        const d = new Date(today);
        d.setDate(d.getDate() - dayOfWeek - week * 7 + day);
        const dateStr = d.toISOString().split("T")[0];
        weekData.push({
          date: dateStr,
          count: data[dateStr] || 0,
        });
      }
      grid.push(weekData);
    }
    return grid;
  };

  const getColor = (count: number): string => {
    if (count === 0) return "var(--color-bg-input)";
    if (count <= 2) return "rgba(52, 199, 89, 0.25)";
    if (count <= 5) return "rgba(52, 199, 89, 0.5)";
    if (count <= 10) return "rgba(52, 199, 89, 0.75)";
    return "var(--color-success)";
  };

  if (loading) {
    return (
      <div className="px-3 py-2">
        <div className="text-[11px] text-text-muted mb-2">活动热力图</div>
        <div className="h-12 animate-pulse bg-bg-input rounded" />
      </div>
    );
  }

  const grid = generateGrid();
  const totalDays = Object.keys(data).length;
  const totalActivity = Object.values(data).reduce((a, b) => a + b, 0);

  return (
    <div className="px-3 py-2" style={{ borderTop: "1px solid var(--color-border)" }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-text-muted">活动热力图</span>
        <span className="text-[10px] text-text-muted">{totalActivity} 次活动</span>
      </div>
      <div className="flex gap-0.5 overflow-hidden">
        {grid.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-0.5">
            {week.map((day, di) => (
              <div
                key={di}
                className="w-2.5 h-2.5 rounded-sm cursor-pointer transition-transform hover:scale-125"
                style={{ backgroundColor: getColor(day.count) }}
                title={`${day.date}: ${day.count} 次`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[9px] text-text-muted">少</span>
        <div className="flex gap-0.5">
          {[0, 1, 2, 5, 10].map((c) => (
            <div
              key={c}
              className="w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: getColor(c) }}
            />
          ))}
        </div>
        <span className="text-[9px] text-text-muted">多</span>
      </div>
    </div>
  );
}
