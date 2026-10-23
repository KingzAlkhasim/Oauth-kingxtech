// Pure helpers for turning daily rows into the numbers shown to the site owner.

export interface SiteViewStats {
  total: number;
  today: number;
  last7: number;
  last30: number;
  daily: Array<{ day: string; views: number }>; // last 14 days, oldest first, zeros filled in
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export function buildStats(rows: Array<{ day: string; views: number }>, now = new Date()): SiteViewStats {
  const byDay = new Map(rows.map((r) => [String(r.day).slice(0, 10), Number(r.views)]));
  const sumSince = (days: number) => {
    let n = 0;
    for (let i = 0; i < days; i += 1) n += byDay.get(dayKey(new Date(now.getTime() - i * 86400000))) ?? 0;
    return n;
  };
  const daily: Array<{ day: string; views: number }> = [];
  for (let i = 13; i >= 0; i -= 1) {
    const day = dayKey(new Date(now.getTime() - i * 86400000));
    daily.push({ day, views: byDay.get(day) ?? 0 });
  }
  return {
    total: rows.reduce((n, r) => n + Number(r.views), 0),
    today: sumSince(1),
    last7: sumSince(7),
    last30: sumSince(30),
    daily,
  };
}

