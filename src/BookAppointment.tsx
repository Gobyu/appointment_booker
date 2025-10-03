import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  type ChangeEvent,
  type FormEvent,
} from "react";

const DEFAULT_SLOT_MINUTES = 30;

/* ========= Types ========= */
interface FormData {
  name: string;
  phoneNumber: string;
  email: string;
  date: string; // yyyy-mm-dd
  time: string; // HH:MM (24h)
  duration: string;
  type: string;
  comments: string;
}
type Step = "date" | "time" | "details";
type DayCell = {
  date: Date | null;
  iso: string | null;
  disabled: boolean;
  isToday: boolean;
  isSelected: boolean;
};

type AvailabilityResponse = {
  times?: string[];
  // support multiple backend shapes:
  holidayLabel?: string | null;
  holidayComment?: string | null;
  isOpenOverride?: boolean | null;
  // alt shapes some backends use
  holiday_name?: string | null;
  comment?: string | null;
  is_open?: boolean | null;
  holiday?: {
    name?: string | null;
    comment?: string | null;
    is_open?: boolean | null;
  } | null;
};

/* ========= Utilities ========= */
export const onlyDigits = (s: string) => s.replace(/\D/g, "");
export const toE164 = (raw: string) => {
  const d = onlyDigits(raw);
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
};
export const isValidNANP = (raw: string) => {
  const d = onlyDigits(raw);
  return d.length === 10 || (d.length === 11 && d.startsWith("1"));
};
export const formatPrettyNANP = (rawOrE164: string) => {
  const digits = onlyDigits(rawOrE164).replace(/^1(?=\d{10}$)/, "");
  if (digits.length !== 10) return rawOrE164;
  const areaCode = digits.slice(0, 3);
  const prefix = digits.slice(3, 6);
  const lineNumber = digits.slice(6);
  return `(${areaCode}) ${prefix}-${lineNumber}`;
};

function todayLocalISO(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function isSameDayISO(aISO: string, bISO: string) {
  return aISO === bISO;
}
/** Disable any date strictly before today; keep “today” selectable (time is validated later). */
function isPastDateISO(iso: string): boolean {
  const startOfTarget = new Date(iso + "T00:00");
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return startOfTarget < startOfToday;
}
function humanTimeLabel(valueHHmm: string) {
  const [hh, mm] = valueHHmm.split(":").map(Number);
  const displayHour = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
  const ampm = hh < 12 ? "AM" : "PM";
  return `${displayHour}:${String(mm).padStart(2, "0")} ${ampm}`;
}
/** Group half-hour times into rows by hour: left = :00, right = :30. */
function groupHalfHours(times: string[]) {
  type Row = { hour: number; zero: string | null; thirty: string | null };
  const sorted = [...times].sort();
  const map = new Map<number, Row>();
  for (const t of sorted) {
    const [hh, mm] = t.split(":").map(Number);
    if (!map.has(hh)) map.set(hh, { hour: hh, zero: null, thirty: null });
    const row = map.get(hh)!;
    if (mm === 0) row.zero = t;
    if (mm === 30) row.thirty = t;
  }
  return Array.from(map.values()).filter((r) => r.zero || r.thirty);
}

/* ========= Component ========= */
function BookAppointment() {
  const [step, setStep] = useState<Step>("date");
  const [formData, setFormData] = useState<FormData>({
    name: "",
    phoneNumber: "",
    email: "",
    date: "",
    time: "",
    duration: "",
    type: "",
    comments: "",
  });
  const [viewMonth, setViewMonth] = useState<Date>(() =>
    startOfMonth(new Date())
  );

  const [availableTimes, setAvailableTimes] = useState<string[]>([]);
  const [loadingTimes, setLoadingTimes] = useState(false);
  const [timesError, setTimesError] = useState<string | null>(null);

  // holiday meta from API so we can show "closed for {holiday}"
  const [holidayInfo, setHolidayInfo] = useState<{
    label: string | null;
    comment: string | null;
    isOpenOverride: boolean | null;
  } | null>(null);

  const weeks = useMemo<DayCell[][]>(() => {
    const first = startOfMonth(viewMonth);
    const last = endOfMonth(viewMonth);
    const startWeekday = first.getDay(); // 0=Sun
    const daysInMonth = last.getDate();

    const cells: DayCell[] = [];
    for (let i = 0; i < startWeekday; i++) {
      cells.push({
        date: null,
        iso: null,
        disabled: true,
        isToday: false,
        isSelected: false,
      });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const cellDate = new Date(
        viewMonth.getFullYear(),
        viewMonth.getMonth(),
        day
      );
      const iso = toISODate(cellDate);
      const disabled = isPastDateISO(iso);
      const isToday = iso === todayLocalISO();
      const isSelected = formData.date
        ? isSameDayISO(formData.date, iso)
        : false;
      cells.push({ date: cellDate, iso, disabled, isToday, isSelected });
    }
    while (cells.length % 7 !== 0) {
      cells.push({
        date: null,
        iso: null,
        disabled: true,
        isToday: false,
        isSelected: false,
      });
    }
    const out: DayCell[][] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [viewMonth, formData.date]);

  /** Normalize various backend shapes into one */
  function normalizeAvailability(data: AvailabilityResponse) {
    const holidayLabel =
      data.holidayLabel ??
      data.holiday_name ??
      data.holiday?.name ??
      // some APIs just return a string in `holiday`
      (typeof (data as any).holiday === "string"
        ? (data as any).holiday
        : null) ??
      null;

    const holidayComment =
      data.holidayComment ?? data.comment ?? data.holiday?.comment ?? null;

    const isOpenOverride =
      data.isOpenOverride ?? data.is_open ?? data.holiday?.is_open ?? null;

    const times =
      data.times ?? (data as any).available ?? (data as any).slots ?? [];
    return { times, holidayLabel, holidayComment, isOpenOverride };
  }

  /**
   * Try GET (camelCase), then GET (snake_case), then POST body.
   * This avoids 500s caused by missing/renamed params on the server.
   */
  async function fetchAvailability(
    dateISO: string,
    slotMinutes = DEFAULT_SLOT_MINUTES,
    signal?: AbortSignal
  ) {
    // 1) GET with camelCase
    const qs1 = new URLSearchParams({
      date: dateISO,
      slotMinutes: String(slotMinutes),
    });
    let res = await fetch(`/api/availability?${qs1.toString()}`, { signal });
    if (!res.ok) {
      // 2) GET with snake_case
      const qs2 = new URLSearchParams({
        date: dateISO,
        slot_minutes: String(slotMinutes),
      });
      res = await fetch(`/api/availability?${qs2.toString()}`, { signal });
      if (!res.ok) {
        // 3) POST body with both keys just in case
        const resPost = await fetch(`/api/availability`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify({
            date: dateISO,
            slotMinutes,
            slot_minutes: slotMinutes,
          }),
        });
        if (!resPost.ok) throw new Error(`Availability HTTP ${resPost.status}`);
        return normalizeAvailability(await resPost.json());
      }
    }
    return normalizeAvailability(await res.json());
  }

  // Fetch availability when a date is chosen and we're on the "time" step
  useEffect(() => {
    if (!formData.date || step !== "time") return;
    const ac = new AbortController();
    (async () => {
      try {
        setLoadingTimes(true);
        setTimesError(null);
        const data = await fetchAvailability(
          formData.date,
          DEFAULT_SLOT_MINUTES,
          ac.signal
        );
        setAvailableTimes(data.times || []);
        setHolidayInfo({
          label: data.holidayLabel ?? null,
          comment: data.holidayComment ?? null,
          isOpenOverride: data.isOpenOverride ?? null,
        });
      } catch (err: any) {
        if (err.name !== "AbortError") {
          console.error("Error loading availability:", err);
          setTimesError("Couldn't load available times. Try again.");
        }
      } finally {
        setLoadingTimes(false);
      }
    })();
    return () => ac.abort();
  }, [formData.date, step]);

  /* ====== Handlers ====== */
  const handleFieldChange = useCallback(
    (
      e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
    ) => {
      const { name, value } = e.target;
      setFormData((prev) => ({ ...prev, [name]: value }));
    },
    []
  );

  const handlePickDate = useCallback((iso: string | null) => {
    if (!iso) return;
    if (isPastDateISO(iso)) return;
    setFormData((prev) => ({ ...prev, date: iso, time: "" }));
    setAvailableTimes([]);
    setHolidayInfo(null);
    setStep("time");
  }, []);

  const handlePickTime = useCallback((valueHHmm: string) => {
    setFormData((prev) => ({ ...prev, time: valueHHmm }));
    setStep("details");
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!formData.date || !formData.time) {
      alert("Please choose a date and time.");
      return;
    }
    if (!formData.duration) {
      alert("Please choose a duration.");
      return;
    }
    if (!isValidNANP(formData.phoneNumber)) {
      alert(
        "Invalid phone number. Enter 10 digits, or 11 starting with 1. Dashes/spaces allowed."
      );
      return;
    }
    const phoneE164 = toE164(formData.phoneNumber);
    if (!phoneE164) {
      alert("Invalid phone number format.");
      return;
    }
    if (!formData.type) {
      alert("Please choose a type of appointment.");
      return;
    }

    const selectedDateTime = new Date(`${formData.date}T${formData.time}`);
    if (selectedDateTime < new Date()) {
      alert("Appointment date and time cannot be in the past.");
      return;
    }

    try {
      const payload = { ...formData, phoneNumber: phoneE164 };
      const response = await fetch("/api/BookAppointment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        alert(`Appointment scheduled on ${formData.date} at ${formData.time}`);
        setFormData({
          name: "",
          phoneNumber: "",
          email: "",
          date: "",
          time: "",
          duration: "",
          type: "",
          comments: "",
        });
        setAvailableTimes([]);
        setHolidayInfo(null);
        setStep("date");
      } else {
        const msg = await response.text().catch(() => "");
        console.error("BookAppointment failed:", response.status, msg);
        alert("Failed to schedule appointment.");
      }
    } catch (error) {
      console.error("Error submitting appointment:", error);
      alert("Error submitting appointment");
    }
  };

  /* ====== UI ====== */
  return (
    <div className="max-w-6xl mx-auto px-4 pb-16">
      <h1 className="text-3xl font-bold text-center mb-6">
        Book Your Appointment
      </h1>

      {/* Progress / Steps */}
      <div className="flex items-center justify-center gap-2 mb-6 text-sm">
        {(["date", "time", "details"] as Step[]).map((s, i) => {
          const active = step === s;
          const completed =
            (step === "time" && s === "date") ||
            (step === "details" && (s === "date" || s === "time"));
          return (
            <div key={s} className="flex items-center">
              <div
                className={[
                  "px-3 py-1 rounded-full border",
                  active
                    ? "bg-white text-black border-white"
                    : completed
                    ? "bg-green-600 text-white border-green-600"
                    : "bg-[#252525] text-white border-[#444]",
                ].join(" ")}
              >
                {i + 1}. {s.toUpperCase()}
              </div>
              {i < 2 && <span className="mx-2 text-[#777]">—</span>}
            </div>
          );
        })}
      </div>

      {/* ===== Two-column layout for TIME and DETAILS ===== */}
      {step === "date" ? (
        <section className="mx-auto max-w-xl bg-[#1b1b1b] border border-[#333] rounded-2xl p-4 shadow">
          <header className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => setViewMonth((m) => addMonths(m, -1))}
              className="px-3 py-1 rounded border border-[#444] hover:bg-[#2a2a2a]"
              aria-label="Previous month"
            >
              ◀
            </button>
            <h2 className="text-lg font-semibold">
              {viewMonth.toLocaleString(undefined, {
                month: "long",
                year: "numeric",
              })}
            </h2>
            <button
              type="button"
              onClick={() => setViewMonth((m) => addMonths(m, +1))}
              className="px-3 py-1 rounded border border-[#444] hover:bg-[#2a2a2a]"
              aria-label="Next month"
            >
              ▶
            </button>
          </header>

          <div className="grid grid-cols-7 text-center text-xs text-[#aaa] mb-2">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="py-2">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1" role="grid">
            {weeks.flat().map((cell, idx) => {
              if (!cell.date) {
                return (
                  <div
                    key={idx}
                    className="aspect-square rounded-xl border border-transparent"
                  />
                );
              }
              const base =
                "aspect-square rounded-xl flex items-center justify-center select-none";
              const style = cell.disabled
                ? "text-[#666] border border-[#2e2e2e] bg-[#141414] cursor-not-allowed"
                : "border border-[#3a3a3a] bg-[#222] hover:bg-[#2b2b2b] cursor-pointer";
              const todayRing = cell.isToday ? " ring-1 ring-white/40" : "";
              const selectedStyle = cell.isSelected
                ? " !bg-white !text-black border-white"
                : "";
              return (
                <button
                  key={cell.iso ?? idx}
                  type="button"
                  onClick={() => handlePickDate(cell.iso)}
                  disabled={cell.disabled}
                  className={`${base} ${style}${todayRing}${selectedStyle}`}
                  aria-label={cell.iso!}
                  aria-pressed={cell.isSelected}
                >
                  {cell.date.getDate()}
                </button>
              );
            })}
          </div>
        </section>
      ) : (
        <div className="grid md:grid-cols-2 gap-6 items-start">
          {/* LEFT: Calendar (always visible) */}
          <section className="bg-[#1b1b1b] border border-[#333] rounded-2xl p-4 shadow">
            <header className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={() => setViewMonth((m) => addMonths(m, -1))}
                className="px-3 py-1 rounded border border-[#444] hover:bg-[#2a2a2a]"
                aria-label="Previous month"
              >
                ◀
              </button>
              <h2 className="text-lg font-semibold">
                {viewMonth.toLocaleString(undefined, {
                  month: "long",
                  year: "numeric",
                })}
              </h2>
              <button
                type="button"
                onClick={() => setViewMonth((m) => addMonths(m, +1))}
                className="px-3 py-1 rounded border border-[#444] hover:bg-[#2a2a2a]"
                aria-label="Next month"
              >
                ▶
              </button>
            </header>

            <div className="grid grid-cols-7 text-center text-xs text-[#aaa] mb-2">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="py-2">
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1" role="grid">
              {weeks.flat().map((cell, idx) => {
                if (!cell.date) {
                  return (
                    <div
                      key={idx}
                      className="aspect-square rounded-xl border border-transparent"
                    />
                  );
                }
                const base =
                  "aspect-square rounded-xl flex items-center justify-center select-none";
                const style = cell.disabled
                  ? "text-[#666] border border-[#2e2e2e] bg-[#141414] cursor-not-allowed"
                  : "border border-[#3a3a3a] bg-[#222] hover:bg-[#2b2b2b] cursor-pointer";
                const todayRing = cell.isToday ? " ring-1 ring-white/40" : "";
                const selectedStyle = cell.isSelected
                  ? " !bg-white !text-black border-white"
                  : "";
                return (
                  <button
                    key={cell.iso ?? idx}
                    type="button"
                    onClick={() => handlePickDate(cell.iso)}
                    disabled={cell.disabled}
                    className={`${base} ${style}${todayRing}${selectedStyle}`}
                    aria-label={cell.iso!}
                    aria-pressed={cell.isSelected}
                  >
                    {cell.date.getDate()}
                  </button>
                );
              })}
            </div>
          </section>

          {/* RIGHT: Time picker OR Minimized header + Info form */}
          {step === "time" && (
            <section className="bg-[#1b1b1b] border border-[#333] rounded-2xl p-4 shadow">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xl font-semibold">
                  {new Date(formData.date + "T00:00").toLocaleDateString(
                    undefined,
                    {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    }
                  )}
                </h2>
              </div>

              {loadingTimes && <p>Loading available times…</p>}
              {timesError && <div className="text-red-400">{timesError}</div>}

              {!loadingTimes && !timesError && (
                <>
                  {availableTimes.length === 0 ? (
                    holidayInfo?.label &&
                    holidayInfo?.isOpenOverride === false ? (
                      <div className="space-y-1">
                        <p>
                          We are closed for{" "}
                          <span className="font-semibold">
                            {holidayInfo.label}
                          </span>
                          .
                        </p>
                        {holidayInfo.comment && (
                          <p className="text-sm text-[#aaa]">
                            {holidayInfo.comment}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p>
                        No times available for this date. Please pick another
                        date.
                      </p>
                    )
                  ) : (
                    <div className="space-y-2">
                      {groupHalfHours(availableTimes).map((row) => (
                        <div key={row.hour} className="grid grid-cols-2 gap-2">
                          {row.zero ? (
                            <button
                              type="button"
                              onClick={() => handlePickTime(row.zero!)}
                              className="w-full px-3 py-2 rounded-xl border border-[#3a3a3a] bg-[#222] hover:bg-[#2b2b2b]"
                            >
                              {humanTimeLabel(row.zero!)}
                            </button>
                          ) : (
                            <button
                              type="button"
                              aria-hidden
                              tabIndex={-1}
                              disabled
                              className="invisible w-full px-3 py-2 rounded-xl border border-[#3a3a3a] bg-[#222]"
                            />
                          )}

                          {row.thirty ? (
                            <button
                              type="button"
                              onClick={() => handlePickTime(row.thirty!)}
                              className="w-full px-3 py-2 rounded-xl border border-[#3a3a3a] bg-[#222] hover:bg-[#2b2b2b]"
                            >
                              {humanTimeLabel(row.thirty!)}
                            </button>
                          ) : (
                            <button
                              type="button"
                              aria-hidden
                              tabIndex={-1}
                              disabled
                              className="invisible w-full px-3 py-2 rounded-xl border border-[#3a3a3a] bg-[#222]"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              <div className="mt-4 text-sm text-[#aaa]">
                * Availability assumes a {DEFAULT_SLOT_MINUTES}-minute slot.
                You’ll confirm duration next.
              </div>
            </section>
          )}

          {step === "details" && (
            <section>
              {/* Minimized time picker header */}
              <div className="bg-[#1b1b1b] border border-[#333] rounded-2xl p-3 shadow mb-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm">
                    <div className="text-[#aaa] leading-tight">Selected</div>
                    <div className="font-semibold">
                      {new Date(formData.date + "T00:00").toLocaleDateString(
                        undefined,
                        {
                          weekday: "long",
                          month: "long",
                          day: "numeric",
                          year: "numeric",
                        }
                      )}{" "}
                      · {humanTimeLabel(formData.time)}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setStep("time")}
                      className="text-xs px-3 py-1 rounded border border-[#444] hover:bg-[#2a2a2a]"
                    >
                      Change time
                    </button>
                  </div>
                </div>
              </div>

              {/* Info form below minimized header */}
              <form
                onSubmit={handleSubmit}
                className="bg-[#1b1b1b] border border-[#333] rounded-2xl p-4 shadow"
              >
                <label className="block text-left mb-4 font-bold">
                  Name* :
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleFieldChange}
                    required
                    className="w-full p-2.5 mt-1 rounded border border-[#ccc] text-base box-border"
                  />
                </label>

                <label className="block text-left mb-4 font-bold">
                  Phone Number* :
                  <input
                    type="tel"
                    name="phoneNumber"
                    value={formData.phoneNumber}
                    onChange={handleFieldChange}
                    placeholder="(555) 123-4567"
                    required
                    className="w-full p-2.5 mt-1 rounded border border-[#ccc] text-base box-border"
                  />
                </label>

                <label className="block text-left mb-4 font-bold">
                  Email :
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleFieldChange}
                    className="w-full p-2.5 mt-1 rounded border border-[#ccc] text-base box-border"
                  />
                </label>

                <label className="block text-left mb-4 font-bold">
                  Duration* :
                  <select
                    name="duration"
                    value={formData.duration}
                    onChange={handleFieldChange}
                    required
                    className="w-full p-2.5 mt-1 rounded border border-[#ccc] text-base box-border bg-[#252525] text-white"
                  >
                    <option value="">Select duration</option>
                    <option value="30">30 minutes</option>
                    <option value="60">1 hour</option>
                  </select>
                </label>

                <label className="block text-left mb-4 font-bold">
                  Type of Appointment* :
                  <select
                    name="type"
                    value={formData.type}
                    onChange={handleFieldChange}
                    required
                    className="bg-[#252525] text-white w-full p-2.5 mt-1 rounded border border-[#ccc] text-base box-border"
                  >
                    <option value="">Select</option>
                    <option value="consultation">consultation</option>
                    <option value="checkup">checkup</option>
                    <option value="other">other</option>
                  </select>
                </label>

                <label className="block text-left mb-4 font-bold">
                  Additional Information:
                  <textarea
                    name="comments"
                    value={formData.comments}
                    onChange={handleFieldChange}
                    className="w-full p-2.5 mt-1 rounded border border-[#ccc] text-base box-border"
                  />
                </label>

                <button
                  type="submit"
                  className="mt-2 inline-flex items-center justify-center px-4 py-2 rounded-xl bg-[#252525] text-white font-semibold hover:opacity-90"
                >
                  Place Appointment
                </button>
              </form>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

export default BookAppointment;
