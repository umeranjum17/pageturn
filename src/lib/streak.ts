// Reading streak: a day counts once a minute of reading lands on it, and
// each week (Monday to Sunday) forgives one missed day automatically.

export const MIN_SECONDS_FOR_DAY = 60;

export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function weekKey(date: Date): string {
  const monday = new Date(date);
  monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return dayKey(monday);
}

/** Number of days read in the current streak. Today never counts against it. */
export function streakLength(secondsByDay: Record<string, number>, today: Date): number {
  const read = (d: Date) => (secondsByDay[dayKey(d)] ?? 0) >= MIN_SECONDS_FOR_DAY;
  const earliest = Object.keys(secondsByDay)
    .filter((k) => secondsByDay[k] >= MIN_SECONDS_FOR_DAY)
    .sort()[0];
  if (!earliest) return 0;

  let count = 0;
  const restUsed = new Set<string>();
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (read(cursor)) count++;
  cursor.setDate(cursor.getDate() - 1);

  while (dayKey(cursor) >= earliest) {
    if (read(cursor)) {
      count++;
    } else {
      const week = weekKey(cursor);
      if (restUsed.has(week)) break;
      restUsed.add(week);
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}
