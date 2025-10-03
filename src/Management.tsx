// management.tsx
import { useEffect, useState } from "react";

/* ========= Types aligned with your DB ========= */
type BusinessHour = {
  week_day: number; // 1 = Monday … 7 = Sunday
  start_time: string | null; // "HH:MM" (UI) or null
  end_time: string | null; // "HH:MM" (UI) or null
  is_open: boolean; // NEW in UI state
};

type HolidayHour = {
  id: number; // PK
  start_date: string; // "YYYY-MM-DD"
  end_date: string | null; // "YYYY-MM-DD" or null
  holiday: string;
  comment: string | null;
  is_open: boolean;
  start_time: string | null; // "HH:MM" (UI) or null
  end_time: string | null; // "HH:MM" (UI) or null
};

/* ========= Helpers ========= */
const DAY_NAMES: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};

// Normalize "HH:MM" to "HH:MM:00" (for API / DB)
function withSeconds(t: string | null | undefined): string | null {
  if (!t) return null;
  return /^\d{2}:\d{2}:\d{2}$/.test(t) ? t : `${t}:00`;
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(iso: string, n: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
/* ========= Component ========= */
export default function Management() {
  // ---- Business hours state ----
  const [bizLoading, setBizLoading] = useState(false);
  const [bizError, setBizError] = useState<string | null>(null);
  // Keep per-day editable rows; if API returns nothing for a day, we default to closed with sensible times
  const [bizRows, setBizRows] = useState<Record<number, BusinessHour>>(() => {
    const base: Record<number, BusinessHour> = {} as any;
    for (let d = 1; d <= 7; d++) {
      base[d] = {
        week_day: d,
        start_time: "09:00",
        end_time: "17:00",
        is_open: false,
      };
    }
    return base;
  });

  // ---- Holiday hours state ----
  const [holLoading, setHolLoading] = useState(false);
  const [holError, setHolError] = useState<string | null>(null);
  const [holidays, setHolidays] = useState<HolidayHour[]>([]);
  const [rangeFrom, setRangeFrom] = useState(() => todayISO());
  const [rangeTo, setRangeTo] = useState(() => addDays(todayISO(), 180));

  // Add Holiday form
  const [newHoliday, setNewHoliday] = useState<HolidayHour>({
    id: 0,
    start_date: todayISO(),
    end_date: null,
    holiday: "",
    comment: null,
    is_open: false,
    start_time: null,
    end_time: null,
  });

  // Fetch business hours
  useEffect(() => {
    (async () => {
      setBizLoading(true);
      setBizError(null);
      try {
        // GET /api/admin/business-hours -> { week_day, start_time, end_time, is_open }[]
        const res = await fetch("/api/admin/business-hours");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: Array<{
          week_day: number;
          start_time: string | null;
          end_time: string | null;
          is_open: 0 | 1 | boolean;
        }> = await res.json();

        // Build a full 1..7 map with defaults for missing days
        const next: Record<number, BusinessHour> = { ...bizRows };
        for (let d = 1; d <= 7; d++) {
          next[d] = {
            week_day: d,
            start_time: "09:00",
            end_time: "17:00",
            is_open: false,
          };
        }
        data.forEach((row) => {
          next[row.week_day] = {
            week_day: row.week_day,
            // API already formats '%H:%i' but keep null-safe + slice just in case
            start_time: row.start_time ? row.start_time.slice(0, 5) : "09:00",
            end_time: row.end_time ? row.end_time.slice(0, 5) : "17:00",
            is_open: !!row.is_open,
          };
        });
        setBizRows(next);
      } catch (e: any) {
        setBizError(e?.message || "Failed to load business hours");
      } finally {
        setBizLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch holiday hours
  const reloadHolidays = async () => {
    setHolLoading(true);
    setHolError(null);
    try {
      const params = new URLSearchParams({ from: rangeFrom, to: rangeTo });
      const res = await fetch(`/api/admin/holiday-hours?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: HolidayHour[] = await res.json();
      // Normalize time strings to HH:MM for inputs
      setHolidays(
        data.map((h) => ({
          ...h,
          comment: h.comment ?? null,
          start_time: h.start_time ? h.start_time.slice(0, 5) : null,
          end_time: h.end_time ? h.end_time.slice(0, 5) : null,
        }))
      );
    } catch (e: any) {
      setHolError(e?.message || "Failed to load holiday hours");
    } finally {
      setHolLoading(false);
    }
  };

  useEffect(() => {
    reloadHolidays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeFrom, rangeTo]);

  /* ===== Handlers: Business Hours ===== */

  const handleBizChange = (
    day: number,
    field: "start_time" | "end_time",
    value: string
  ) => {
    setBizRows((prev) => {
      const cur = prev[day];
      return { ...prev, [day]: { ...cur, [field]: value } };
    });
  };

  const putBusinessDay = async (day: number, row: BusinessHour) => {
    const payload = {
      is_open: row.is_open,
      start_time: row.is_open ? withSeconds(row.start_time) : null,
      end_time: row.is_open ? withSeconds(row.end_time) : null,
    };
    const res = await fetch(`/api/admin/business-hours/${day}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${msg || ""}`.trim());
    }
  };

  const handleBizSaveDay = async (day: number) => {
    const row = bizRows[day];

    if (row.is_open) {
      const st = row.start_time;
      const en = row.end_time;

      if (!st || !en) {
        alert("Please set both start and end time.");
        return;
      }
      if (toMinutes(st) >= toMinutes(en)) {
        alert("Start time must be before end time.");
        return;
      }
    }

    try {
      await putBusinessDay(day, row);
      alert(`${DAY_NAMES[day]} saved.`);
    } catch (e: any) {
      alert(
        `Failed to save ${DAY_NAMES[day]}: ${e?.message || "Unknown error"}`
      );
    }
  };

  const handleBizCloseDay = async (day: number) => {
    if (!confirm(`Close every ${DAY_NAMES[day]}?`)) return;
    try {
      const closedRow: BusinessHour = {
        ...bizRows[day],
        is_open: false,
      };
      await putBusinessDay(day, closedRow);
      setBizRows((p) => ({ ...p, [day]: closedRow }));
    } catch (e: any) {
      alert(
        `Failed to close ${DAY_NAMES[day]}: ${e?.message || "Unknown error"}`
      );
    }
  };

  const handleBizOpenAndSave = async (day: number) => {
    // make sure these are strings, never null
    const start = bizRows[day].start_time ?? "09:00";
    const end = bizRows[day].end_time ?? "17:00";

    let draft = {
      ...bizRows[day],
      is_open: true,
      start_time: start,
      end_time: end,
    };

    // compare safely as numbers
    if (toMinutes(draft.start_time) >= toMinutes(draft.end_time)) {
      draft = { ...draft, start_time: "09:00", end_time: "17:00" };
    }

    try {
      await putBusinessDay(day, draft);
      setBizRows((p) => ({ ...p, [day]: draft }));
      alert(`${DAY_NAMES[day]} opened & saved.`);
    } catch (e: any) {
      alert(
        `Failed to open ${DAY_NAMES[day]}: ${e?.message || "Unknown error"}`
      );
    }
  };

  /* ===== Handlers: Holiday Hours ===== */

  const handleAddHoliday = async () => {
    if (!newHoliday.start_date) return alert("Select a start date.");
    if (!newHoliday.holiday.trim()) return alert("Enter a holiday or label.");

    const payload = {
      start_date: newHoliday.start_date,
      end_date: newHoliday.end_date,
      holiday: newHoliday.holiday.trim(),
      comment: newHoliday.comment?.trim() || null,
      is_open: newHoliday.is_open,
      start_time: newHoliday.is_open
        ? withSeconds(newHoliday.start_time)
        : null,
      end_time: newHoliday.is_open ? withSeconds(newHoliday.end_time) : null,
    };

    if (payload.end_date && payload.end_date < payload.start_date) {
      return alert("End date must be on/after start date.");
    }
    if (
      payload.is_open &&
      (!payload.start_time ||
        !payload.end_time ||
        payload.start_time >= payload.end_time)
    ) {
      return alert("For 'Open' overrides, start must be before end.");
    }

    try {
      // POST /api/admin/holiday-hours
      const res = await fetch("/api/admin/holiday-hours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNewHoliday({
        id: 0,
        start_date: todayISO(),
        end_date: null,
        holiday: "",
        comment: null,
        is_open: false,
        start_time: null,
        end_time: null,
      });
      await reloadHolidays();
    } catch (e: any) {
      alert(`Failed to add holiday: ${e?.message || "Unknown error"}`);
    }
  };

  const handleUpdateHoliday = async (idx: number) => {
    const h = holidays[idx];
    const payload = {
      start_date: h.start_date,
      end_date: h.end_date,
      holiday: h.holiday.trim(),
      comment: h.comment?.trim() || null,
      is_open: h.is_open,
      start_time: h.is_open ? withSeconds(h.start_time) : null,
      end_time: h.is_open ? withSeconds(h.end_time) : null,
    };

    if (payload.end_date && payload.end_date < payload.start_date) {
      return alert("End date must be on/after start date.");
    }
    if (
      payload.is_open &&
      (!payload.start_time ||
        !payload.end_time ||
        payload.start_time >= payload.end_time)
    ) {
      return alert("For 'Open' overrides, start must be before end.");
    }

    try {
      // PUT /api/admin/holiday-hours/:id
      const res = await fetch(`/api/admin/holiday-hours/${h.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await reloadHolidays();
    } catch (e: any) {
      const range = h.end_date
        ? `${h.start_date} – ${h.end_date}`
        : h.start_date;
      alert(`Failed to update ${range}: ${e?.message || "Unknown error"}`);
    }
  };

  const handleDeleteHoliday = async (idx: number) => {
    const h = holidays[idx];
    const range = h.end_date ? `${h.start_date} – ${h.end_date}` : h.start_date;
    if (!confirm(`Delete override for ${range} (${h.holiday})?`)) return;
    try {
      // DELETE /api/admin/holiday-hours/:id
      const res = await fetch(`/api/admin/holiday-hours/${h.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await reloadHolidays();
    } catch (e: any) {
      alert(`Failed to delete ${range}: ${e?.message || "Unknown error"}`);
    }
  };

  /* ========= UI ========= */
  return (
    <div className="max-w-6xl mx-auto px-4 py-10 space-y-8">
      <h1 className="text-3xl font-bold">Business Management</h1>

      {/* ===== Business Hours Panel ===== */}
      <section className="bg-[#1b1b1b] border border-[#333] rounded-2xl shadow">
        <div className="border-b border-[#333] px-4 py-3">
          <h2 className="text-xl font-semibold">Weekly Business Hours</h2>
          <p className="text-sm text-[#aaa]">
            Toggle a weekday open/closed and set default hours.
          </p>
        </div>

        <div className="p-4">
          {bizLoading && <div>Loading business hours…</div>}
          {bizError && <div className="text-red-400">{bizError}</div>}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[#bbb]">
                <tr>
                  <th className="py-2">Weekday</th>
                  <th className="py-2">Start</th>
                  <th className="py-2">End</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 7 }, (_, i) => i + 1).map((day) => {
                  const row = bizRows[day];
                  const closed = !row.is_open;
                  return (
                    <tr key={day} className="border-t border-[#2a2a2a]">
                      <td className="py-2 pr-4 font-medium">
                        {DAY_NAMES[day]}
                      </td>
                      <td className="py-2 pr-2">
                        {closed ? (
                          <span className="text-[#888]">—</span>
                        ) : (
                          <input
                            type="time"
                            value={row.start_time || ""}
                            onChange={(e) =>
                              handleBizChange(day, "start_time", e.target.value)
                            }
                            className="bg-[#252525] text-white border border-[#444] rounded px-2 py-1"
                          />
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        {closed ? (
                          <span className="text-[#888]">—</span>
                        ) : (
                          <input
                            type="time"
                            value={row.end_time || ""}
                            onChange={(e) =>
                              handleBizChange(day, "end_time", e.target.value)
                            }
                            className="bg-[#252525] text-white border border-[#444] rounded px-2 py-1"
                          />
                        )}
                      </td>
                      <td className="py-2">
                        {closed ? (
                          <button
                            className="px-3 py-1 rounded border border-[#444] hover:bg-[#2a2a2a]"
                            onClick={() => handleBizOpenAndSave(day)}
                          >
                            Open & Save
                          </button>
                        ) : (
                          <div className="flex gap-2">
                            <button
                              className="px-3 py-1 rounded bg-[#252525] text-white font-semibold hover:opacity-90"
                              onClick={() => handleBizSaveDay(day)}
                            >
                              Save
                            </button>
                            <button
                              className="px-3 py-1 rounded border border-[#444] hover:bg-[#2a2a2a]"
                              onClick={() => handleBizCloseDay(day)}
                            >
                              Close
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ===== Holiday / Overrides Panel ===== */}
      <section className="bg-[#1b1b1b] border border-[#333] rounded-2xl shadow">
        <div className="border-b border-[#333] px-4 py-3 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Holiday / Date Overrides</h2>
            <p className="text-sm text-[#aaa]">
              These apply to specific dates (closures, shortened days, multi-day
              time off).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm">
              <span className="mr-1 text-[#aaa]">From</span>
              <input
                type="date"
                value={rangeFrom}
                onChange={(e) => setRangeFrom(e.target.value)}
                className="bg-[#252525] text-white border border-[#444] rounded px-2 py-1"
              />
            </label>
            <label className="text-sm">
              <span className="mr-1 text-[#aaa]">To</span>
              <input
                type="date"
                value={rangeTo}
                onChange={(e) => setRangeTo(e.target.value)}
                className="bg-[#252525] text-white border border-[#444] rounded px-2 py-1"
              />
            </label>
            <button
              onClick={reloadHolidays}
              className="px-3 py-1 rounded border border-[#444] hover:bg-[#2a2a2a] text-sm"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="p-4 grid md:grid-cols-2 gap-6">
          {/* Add new override */}
          <div className="bg-[#161616] border border-[#333] rounded-xl p-4">
            <h3 className="font-semibold mb-3">Add Override</h3>
            <div className="grid gap-3">
              <label className="text-sm">
                <div className="text-[#aaa]">Start date</div>
                <input
                  type="date"
                  value={newHoliday.start_date}
                  onChange={(e) =>
                    setNewHoliday((p) => ({ ...p, start_date: e.target.value }))
                  }
                  className="w-full bg-[#252525] text-white border border-[#444] rounded px-2 py-1"
                />
              </label>

              <label className="text-sm">
                <div className="text-[#aaa]">End date (optional)</div>
                <input
                  type="date"
                  value={newHoliday.end_date ?? ""}
                  onChange={(e) =>
                    setNewHoliday((p) => ({
                      ...p,
                      end_date: e.target.value || null,
                    }))
                  }
                  className="w-full bg-[#252525] text-white border border-[#444] rounded px-2 py-1"
                />
              </label>
              <label className="text-sm">
                <div className="text-[#aaa]">Label</div>
                <input
                  type="text"
                  value={newHoliday.holiday}
                  onChange={(e) =>
                    setNewHoliday((p) => ({ ...p, holiday: e.target.value }))
                  }
                  className="w-full bg-[#252525] text-white border border-[#444] rounded px-2 py-1"
                />
              </label>
              <label className="text-sm">
                <div className="text-[#aaa]">Comment (optional)</div>
                <textarea
                  maxLength={255}
                  value={newHoliday.comment ?? ""}
                  onChange={(e) =>
                    setNewHoliday((p) => ({
                      ...p,
                      comment: e.target.value || null,
                    }))
                  }
                  className="w-full bg-[#252525] text-white border border-[#444] rounded px-2 py-1"
                />
              </label>
              <label className="text-sm inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={newHoliday.is_open}
                  onChange={(e) =>
                    setNewHoliday((p) => ({
                      ...p,
                      is_open: e.target.checked,
                      start_time: e.target.checked
                        ? p.start_time ?? "09:00"
                        : null,
                      end_time: e.target.checked ? p.end_time ?? "17:00" : null,
                    }))
                  }
                />
                <span>Open this day (custom hours)</span>
              </label>

              {newHoliday.is_open && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm">
                    <div className="text-[#aaa]">Start</div>
                    <input
                      type="time"
                      value={newHoliday.start_time ?? ""}
                      onChange={(e) =>
                        setNewHoliday((p) => ({
                          ...p,
                          start_time: e.target.value,
                        }))
                      }
                      className="w-full bg-[#252525] text-white border border-[#444] rounded px-2 py-1"
                    />
                  </label>
                  <label className="text-sm">
                    <div className="text-[#aaa]">End</div>
                    <input
                      type="time"
                      value={newHoliday.end_time ?? ""}
                      onChange={(e) =>
                        setNewHoliday((p) => ({
                          ...p,
                          end_time: e.target.value,
                        }))
                      }
                      className="w-full bg-[#252525] text-white border border-[#444] rounded px-2 py-1"
                    />
                  </label>
                </div>
              )}

              <button
                onClick={handleAddHoliday}
                className="mt-1 px-3 py-2 rounded bg-[#252525] text-white font-semibold hover:opacity-90"
              >
                Add Override
              </button>
              <p className="text-xs text-[#888]">
                Tip: Set label to <code>time off</code> for personal days.
              </p>
            </div>
          </div>

          {/* List / edit overrides */}
          <div>
            <h3 className="font-semibold mb-3">Existing Overrides</h3>
            {holLoading && <div>Loading overrides…</div>}
            {holError && <div className="text-red-400">{holError}</div>}

            {holidays.length === 0 ? (
              <div className="text-[#aaa] text-sm">No overrides in range.</div>
            ) : (
              <div className="space-y-3">
                {holidays.map((h, idx) => (
                  <div
                    key={h.id}
                    className="bg-[#161616] border border-[#333] rounded-xl p-3"
                  >
                    <div className="grid md:grid-cols-[1fr_auto] gap-3 items-start">
                      <div className="grid sm:grid-cols-2 gap-3">
                        <label className="text-sm">
                          <div className="text-[#aaa]">Start date</div>
                          <input
                            type="date"
                            value={h.start_date}
                            onChange={(e) =>
                              setHolidays((arr) =>
                                arr.map((x, i) =>
                                  i === idx
                                    ? { ...x, start_date: e.target.value }
                                    : x
                                )
                              )
                            }
                            className="w-full bg-[#252525] text-white border border-[#444] rounded px-2 py-1"
                          />
                        </label>

                        <label className="text-sm">
                          <div className="text-[#aaa]">End date (optional)</div>
                          <input
                            type="date"
                            value={h.end_date ?? ""}
                            onChange={(e) =>
                              setHolidays((arr) =>
                                arr.map((x, i) =>
                                  i === idx
                                    ? { ...x, end_date: e.target.value || null }
                                    : x
                                )
                              )
                            }
                            className="w-full bg-[#252525] text-white border border-[#444] rounded px-2 py-1"
                          />
                        </label>

                        <label className="text-sm">
                          <div className="text-[#aaa]">Label</div>
                          <input
                            type="text"
                            value={h.holiday}
                            onChange={(e) =>
                              setHolidays((arr) =>
                                arr.map((x, i) =>
                                  i === idx
                                    ? { ...x, holiday: e.target.value }
                                    : x
                                )
                              )
                            }
                            className="w-full bg-[#252525] text-white border border-[#444] rounded px-2 py-1"
                          />
                        </label>

                        <label className="text-sm">
                          <div className="text-[#aaa]">Comment (optional)</div>
                          <textarea
                            maxLength={255}
                            value={h.comment ?? ""}
                            onChange={(e) =>
                              setHolidays((arr) =>
                                arr.map((x, i) =>
                                  i === idx
                                    ? { ...x, comment: e.target.value || null }
                                    : x
                                )
                              )
                            }
                            className="w-full bg-[#252525] text-white border border-[#444] rounded px-2 py-1"
                          />
                        </label>

                        <label className="text-sm inline-flex items-center gap-2 col-span-2">
                          <input
                            type="checkbox"
                            checked={h.is_open}
                            onChange={(e) =>
                              setHolidays((arr) =>
                                arr.map((x, i) =>
                                  i === idx
                                    ? {
                                        ...x,
                                        is_open: e.target.checked,
                                        start_time: e.target.checked
                                          ? x.start_time ?? "09:00"
                                          : null,
                                        end_time: e.target.checked
                                          ? x.end_time ?? "17:00"
                                          : null,
                                      }
                                    : x
                                )
                              )
                            }
                          />
                          <span>Open this day (custom hours)</span>
                        </label>

                        {h.is_open && (
                          <div className="grid grid-cols-2 gap-3 col-span-2">
                            <label className="text-sm">
                              <div className="text-[#aaa]">Start</div>
                              <input
                                type="time"
                                value={h.start_time ?? ""}
                                onChange={(e) =>
                                  setHolidays((arr) =>
                                    arr.map((x, i) =>
                                      i === idx
                                        ? { ...x, start_time: e.target.value }
                                        : x
                                    )
                                  )
                                }
                                className="w-full bg-[#252525] text-white border border-[#444] rounded px-2 py-1"
                              />
                            </label>
                            <label className="text-sm">
                              <div className="text-[#aaa]">End</div>
                              <input
                                type="time"
                                value={h.end_time ?? ""}
                                onChange={(e) =>
                                  setHolidays((arr) =>
                                    arr.map((x, i) =>
                                      i === idx
                                        ? { ...x, end_time: e.target.value }
                                        : x
                                    )
                                  )
                                }
                                className="w-full bg-[#252525] text-white border border-[#444] rounded px-2 py-1"
                              />
                            </label>
                          </div>
                        )}
                      </div>

                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => handleUpdateHoliday(idx)}
                          className="px-3 py-1 rounded bg-[#252525] text-white font-semibold hover:opacity-90"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => handleDeleteHoliday(idx)}
                          className="px-3 py-1 rounded border border-[#444] hover:bg-[#2a2a2a]"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    <div className="mt-2 text-xs text-[#888]">
                      Range: {h.start_date} – {h.end_date ?? h.start_date}
                    </div>
                    {(h.comment ?? "").trim() && (
                      <div className="mt-1 text-xs text-[#bbb] italic">
                        “{h.comment}”
                      </div>
                    )}
                    <div className="mt-1 text-xs text-[#888]">
                      {h.is_open
                        ? `Open ${h.start_time ?? "??"}–${h.end_time ?? "??"}`
                        : "Closed all day"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
