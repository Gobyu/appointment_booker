import React, { useEffect, useMemo, useState } from "react";

interface Appointment {
  id: number;
  name: string;
  phoneNumber: string;
  email: string;
  date: string;
  time: string;
  duration: number;
  type: string;
  comments: string;
  active: number;
  paid: number;
}

type ViewTab = "active" | "past" | "today";

interface EditForm {
  name: string;
  phoneNumber: string;
  email: string;
  date: string;
  time: string;
  duration: string;
  type: string;
  comments: string;
  active: boolean;
  paid: boolean;
}

const onlyDigits = (s: string) => s.replace(/\D/g, "");
const toE164 = (raw: string) => {
  const d = onlyDigits(raw);
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
};
const isValidNANP = (raw: string) => {
  const d = onlyDigits(raw);
  return d.length === 10 || (d.length === 11 && d.startsWith("1"));
};
const formatPrettyNANP = (rawOrE164: string) => {
  const d = onlyDigits(rawOrE164).replace(/^1(?=\d{10}$)/, "");
  if (d.length !== 10) return rawOrE164;
  const a = d.slice(0, 3),
    b = d.slice(3, 6),
    c = d.slice(6);
  return `(${a}) ${b}-${c}`;
};

const ymdLocal = (d: Date) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const coerceToYMD = (dateStr: string) => {
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr.slice(0, 10);
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? dateStr.slice(0, 10) : ymdLocal(d);
};

const buildTimeOptions = (withSeconds: boolean) =>
  Array.from({ length: 13 }, (_, i) => {
    const hour = 9 + i;
    const displayHour = hour <= 12 ? hour : hour - 12;
    const ampm = hour < 12 ? "AM" : "PM";
    const value = withSeconds
      ? `${String(hour).padStart(2, "0")}:00:00`
      : `${String(hour).padStart(2, "0")}:00`;
    return { value, label: `${displayHour}:00 ${ampm}` };
  });

const AllAppointments: React.FC = () => {
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [allAppointments, setAllAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewTab, setViewTab] = useState<ViewTab>("active");
  const [filters, setFilters] = useState({
    id: "",
    name: "",
    phoneNumber: "",
    email: "",
    comments: "",
    paid: false,
    time: "",
    type: "",
    date: "",
    duration: "",
  });
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 50;

  const [editForm, setEditForm] = useState<EditForm>({
    name: "",
    phoneNumber: "",
    email: "",
    date: "",
    time: "",
    duration: "30",
    type: "",
    comments: "",
    active: true,
    paid: false,
  });
  const [bookedTimesForEdit, setBookedTimesForEdit] = useState<string[]>([]);

  const todayStr = useMemo(() => ymdLocal(new Date()), []);

  const openEdit = (appt: Appointment) => {
    setEditForm({
      name: appt.name || "",
      phoneNumber: formatPrettyNANP(appt.phoneNumber || ""),
      email: appt.email || "",
      date: coerceToYMD(appt.date),
      time: appt.time.slice(0, 5),
      duration: String(appt.duration),
      type: appt.type || "",
      comments: appt.comments || "",
      active: appt.active === 1,
      paid: appt.paid === 1,
    });
    setEditing(appt);
  };

  useEffect(() => {
    if (!editing || !editForm.date || !editForm.duration) {
      setBookedTimesForEdit([]);
      return;
    }
    const ac = new AbortController();
    (async () => {
      try {
        const times = Array.from(
          { length: 13 },
          (_, i) => `${String(9 + i).padStart(2, "0")}:00`
        );
        const res = await fetch("/api/availability", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ac.signal,
          body: JSON.stringify({
            date: editForm.date,
            duration: Number(editForm.duration),
            times,
            excludeId: editing.id,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: { conflicts: Record<string, boolean> } = await res.json();
        const blocked = Object.entries(data.conflicts)
          .filter(([, isConflict]) => isConflict)
          .map(([t]) => t);
        setBookedTimesForEdit(blocked);
      } catch (e) {
        if ((e as any).name !== "AbortError")
          console.error("load conflicts:", e);
      }
    })();
    return () => ac.abort();
  }, [editing, editForm.date, editForm.duration]);

  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      setLoading(true);
      try {
        const urls = [
          `/api/appointments?active=1&limit=${pageSize}`,
          `/api/appointments?active=0&limit=${pageSize}`,
        ];
        const [actRes, pastRes] = await Promise.all(
          urls.map((u) => fetch(u, { credentials: "include" }))
        );

        if (!actRes.ok || !pastRes.ok) {
          if (actRes.status === 401 || actRes.status === 403) {
            if (!cancelled) setLoading(false);
            return;
          }
          if (pastRes.status === 401 || pastRes.status === 403) {
            if (!cancelled) setLoading(false);
            return;
          }
          throw new Error(`HTTP ${actRes.status}/${pastRes.status}`);
        }

        const [actData, pastData]: [Appointment[], Appointment[]] =
          await Promise.all([actRes.json(), pastRes.json()]);

        if (!cancelled) {
          setAllAppointments([...actData, ...pastData]);
          setCurrentPage(1);
        }
      } catch (e) {
        console.error("Error fetching appointments:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchAll();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters, viewTab]);

  const handleFilterChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const target = e.target as HTMLInputElement;
    const { name, value, type, checked } = target;
    setFilters((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const filteredAppointments = useMemo(() => {
    const idQuery = filters.id.trim();
    const nameQuery = filters.name.trim().toLowerCase();
    const phoneQuery = filters.phoneNumber.trim().toLowerCase();
    const phoneQueryDigits = filters.phoneNumber.replace(/\D/g, "");
    const emailQuery = filters.email.trim().toLowerCase();
    const commentsQuery = filters.comments.trim().toLowerCase();
    const timeQuery = filters.time.trim();
    const typeQuery = filters.type.trim();
    const dateQuery = filters.date.trim();
    const durationQuery = filters.duration.trim();

    return allAppointments.filter((appt) => {
      if (viewTab === "active" && appt.active !== 1) return false;
      if (viewTab === "past" && appt.active !== 0) return false;
      if (viewTab === "today") {
        if (appt.active !== 1) return false;
        if (coerceToYMD(appt.date) !== todayStr) return false;
      }

      if (phoneQueryDigits) {
        const apptDigits = appt.phoneNumber.replace(/\D/g, "");
        if (!apptDigits.includes(phoneQueryDigits)) return false;
      } else if (phoneQuery) {
        if (!appt.phoneNumber.toLowerCase().includes(phoneQuery)) return false;
      }

      if (idQuery && !String(appt.id).includes(idQuery)) return false;
      if (nameQuery && !appt.name.toLowerCase().includes(nameQuery))
        return false;
      if (emailQuery && !appt.email.toLowerCase().includes(emailQuery))
        return false;
      if (commentsQuery && !appt.comments.toLowerCase().includes(commentsQuery))
        return false;

      if (filters.paid && appt.paid !== 1) return false;

      if (timeQuery && appt.time !== timeQuery) return false;
      if (typeQuery && appt.type !== typeQuery) return false;

      if (viewTab !== "today" && dateQuery) {
        if (coerceToYMD(appt.date) !== dateQuery) return false;
      }

      if (durationQuery) {
        const dur = Number(durationQuery);
        if (!Number.isNaN(dur) && appt.duration !== dur) return false;
      }

      return true;
    });
  }, [allAppointments, filters, viewTab, todayStr]);

  const totalPages = Math.ceil(filteredAppointments.length / pageSize) || 1;
  const displayedAppointments = filteredAppointments.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const timeOptions = useMemo(() => buildTimeOptions(true), []);

  return (
    <div className="mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-center">Appointments</h1>

      <div className="flex justify-center mb-6">
        <div className="inline-flex rounded-lg overflow-hidden">
          <button
            className={`px-4 py-2 text-sm font-medium transition border-l border-zinc-300 ${
              viewTab === "today"
                ? "bg-blue-600 text-white"
                : "bg-gray-200 text-zinc-800 hover:bg-zinc-300"
            }`}
            onClick={() => setViewTab("today")}
          >
            Today
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium transition ${
              viewTab === "active"
                ? "bg-blue-600 text-white"
                : "bg-gray-200 text-zinc-800 hover:bg-zinc-300"
            }`}
            onClick={() => setViewTab("active")}
          >
            Active
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium transition border-l border-zinc-300 ${
              viewTab === "past"
                ? "bg-blue-600 text-white"
                : "bg-gray-200 text-zinc-800 hover:bg-zinc-300"
            }`}
            onClick={() => setViewTab("past")}
          >
            Past
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-center">Loading appointments...</p>
      ) : allAppointments.length === 0 ? (
        <p className="text-center">No appointments found.</p>
      ) : (
        <>
          <div className="w-full px-2 sm:px-4 lg:px-6">
            <div className="overflow-x-auto lg:overflow-visible">
              <table className="w-full min-w-[1100px] table-fixed">
                <thead className="border-b-4 border-zinc-400">
                  <tr className="text-left">
                    <th className="px-2 py-2">ID</th>
                    <th className="px-2 py-2">Name</th>
                    <th className="px-2 py-2">Phone</th>
                    <th className="px-2 py-2">Email</th>
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2">Time</th>
                    <th className="px-2 py-2">Duration</th>
                    <th className="px-2 py-2">Type</th>
                    <th className="px-2 py-2">Comments</th>
                    <th className="px-2 py-2">Paid</th>
                    <th className="px-2 py-2"></th>
                  </tr>

                  <tr className="filters-row">
                    <th className="pb-4 px-2">
                      <input
                        type="text"
                        name="id"
                        value={filters.id}
                        onChange={handleFilterChange}
                        placeholder="Filter ID"
                        className="w-full text-center"
                      />
                    </th>
                    <th className="pb-4 px-2">
                      <input
                        type="text"
                        name="name"
                        value={filters.name}
                        onChange={handleFilterChange}
                        placeholder="Filter Name"
                        className="w-full text-center"
                      />
                    </th>
                    <th className="pb-4 px-2">
                      <input
                        type="text"
                        name="phoneNumber"
                        value={filters.phoneNumber}
                        onChange={handleFilterChange}
                        placeholder="Filter Phone"
                        className="w-full text-center"
                      />
                    </th>
                    <th className="pb-4 px-2">
                      <input
                        type="text"
                        name="email"
                        value={filters.email}
                        onChange={handleFilterChange}
                        placeholder="Filter Email"
                        className="w-full text-center"
                      />
                    </th>
                    <th className="pb-4 px-2">
                      {viewTab !== "today" ? (
                        <input
                          type="date"
                          name="date"
                          value={filters.date}
                          onChange={handleFilterChange}
                          className="w-full text-center"
                        />
                      ) : (
                        <div className="w-full text-center">{todayStr}</div>
                      )}
                    </th>
                    <th className="pb-4 px-2">
                      <select
                        name="time"
                        value={filters.time}
                        onChange={handleFilterChange}
                        className="w-full text-center bg-[#252525] text-white"
                      >
                        <option value="">All</option>
                        {timeOptions.map((t) => (
                          <option
                            key={t.value}
                            value={t.value}
                            className="bg-[#252525] text-white"
                          >
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </th>
                    <th className="pb-4 px-2">
                      <select
                        name="duration"
                        value={filters.duration}
                        onChange={handleFilterChange}
                        className="w-full text-center bg-[#252525] text-white"
                      >
                        <option value="" className="bg-[#252525] text-white">
                          All
                        </option>
                        <option value="30" className="bg-[#252525] text-white">
                          30 mins
                        </option>
                        <option value="60" className="bg-[#252525] text-white">
                          60 mins
                        </option>
                      </select>
                    </th>
                    <th className="pb-4 px-2">
                      <select
                        name="type"
                        value={filters.type}
                        onChange={handleFilterChange}
                        className="w-full text-center bg-[#252525] text-white"
                      >
                        <option value="" className="bg-[#252525] text-white">
                          All
                        </option>
                        <option
                          value="consultation"
                          className="bg-[#252525] text-white"
                        >
                          Consultation
                        </option>
                        <option
                          value="checkup"
                          className="bg-[#252525] text-white"
                        >
                          Check-up
                        </option>
                        <option
                          value="other"
                          className="bg-[#252525] text-white"
                        >
                          Other
                        </option>
                      </select>
                    </th>
                    <th className="pb-4 px-2">
                      <input
                        type="text"
                        name="comments"
                        value={filters.comments}
                        onChange={handleFilterChange}
                        placeholder="Comments"
                        className="w-full text-center"
                      />
                    </th>
                    <th className="pb-4 px-2">
                      <input
                        type="checkbox"
                        name="paid"
                        checked={filters.paid}
                        onChange={handleFilterChange}
                      />
                    </th>
                    <th className="pb-4 px-2" />
                  </tr>
                </thead>

                <tbody className="divide-y divide-zinc-200">
                  {displayedAppointments.map((appt) => (
                    <tr key={appt.id}>
                      <td className="px-2 py-2 align-top">
                        <span
                          className="block truncate"
                          title={String(appt.id)}
                        >
                          {appt.id}
                        </span>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <span
                          className="block max-w-[10rem] break-words whitespace-normal"
                          title={appt.name}
                        >
                          {appt.name}
                        </span>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <span
                          className="block max-w-[10rem] break-words whitespace-normal"
                          title={appt.phoneNumber}
                        >
                          {appt.phoneNumber}
                        </span>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <span
                          className="block max-w-[14rem] break-words whitespace-normal"
                          title={appt.email}
                        >
                          {appt.email}
                        </span>
                      </td>
                      <td className="px-2 py-2 align-top">
                        {new Date(appt.date).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}
                      </td>
                      <td className="px-2 py-2 align-top">{appt.time}</td>
                      <td className="px-2 py-2 align-top">
                        {appt.duration} mins
                      </td>
                      <td className="px-2 py-2 align-top">
                        <span
                          className="block max-w-[9rem] truncate"
                          title={appt.type}
                        >
                          {appt.type}
                        </span>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <div
                          className="max-h-24 overflow-y-auto whitespace-pre-line break-words pr-1"
                          title={appt.comments}
                        >
                          {appt.comments}
                        </div>
                      </td>
                      <td className="px-2 py-2 align-top">
                        {appt.paid === 1 ? "Yes" : "No"}
                      </td>
                      <td className="px-2 py-2 align-middle">
                        <button
                          className="px-2 py-1 border rounded hover:bg-zinc-100"
                          onClick={() => openEdit(appt)}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-center gap-2 mt-4">
            <button
              onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 border rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Prev
            </button>
            {Array.from({ length: totalPages }, (_, i) => (
              <button
                key={i + 1}
                onClick={() => setCurrentPage(i + 1)}
                className={`px-3 py-1 border rounded ${
                  currentPage === i + 1 ? "bg-blue-600 text-white" : ""
                }`}
              >
                {i + 1}
              </button>
            ))}
            <button
              onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
              disabled={currentPage === totalPages}
              className="px-3 py-1 border rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="rounded-xl shadow-xl w-full max-w-lg p-6 bg-[#252525] text-white">
            <h2 className="text-xl font-bold mb-4">
              Edit Appointment #{editing.id}
            </h2>

            <div className="grid gap-3">
              <input
                className="border rounded px-3 py-2 bg-[#252525] text-white"
                placeholder="Name*"
                value={editForm.name}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, name: e.target.value }))
                }
              />
              <input
                className="border rounded px-3 py-2 bg-[#252525] text-white"
                placeholder="Phone*"
                value={editForm.phoneNumber}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, phoneNumber: e.target.value }))
                }
              />
              <input
                className="border rounded px-3 py-2 bg-[#252525] text-white"
                placeholder="Email"
                value={editForm.email}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, email: e.target.value }))
                }
              />

              <input
                type="date"
                className="border rounded px-3 py-2 bg-[#252525] text-white"
                value={editForm.date}
                min={todayStr}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, date: e.target.value }))
                }
              />

              <select
                className="border rounded px-3 py-2 bg-[#252525] text-white"
                value={editForm.time}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, time: e.target.value }))
                }
              >
                {buildTimeOptions(false).map((t) => {
                  const disabled = bookedTimesForEdit.includes(t.value);
                  return (
                    <option
                      key={t.value}
                      value={t.value}
                      disabled={disabled}
                      className="bg-[#252525] text-white disabled:text-[#999]"
                    >
                      {t.label} {disabled ? "(Booked/Unavailable)" : ""}
                    </option>
                  );
                })}
              </select>

              <select
                className="border rounded px-3 py-2 bg-[#252525] text-white"
                value={editForm.duration}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, duration: e.target.value }))
                }
              >
                <option value="30" className="bg-[#252525] text-white">
                  30 minutes
                </option>
                <option value="60" className="bg-[#252525] text-white">
                  1 hour
                </option>
              </select>

              <select
                className="border rounded px-3 py-2 bg-[#252525] text-white"
                value={editForm.type}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, type: e.target.value }))
                }
              >
                <option
                  value="consultation"
                  className="bg-[#252525] text-white"
                >
                  consultation
                </option>
                <option value="checkup" className="bg-[#252525] text-white">
                  checkup
                </option>
                <option value="other" className="bg-[#252525] text-white">
                  other
                </option>
              </select>

              <textarea
                className="border rounded px-3 py-2 bg-[#252525] text-white"
                placeholder="Comments"
                value={editForm.comments}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, comments: e.target.value }))
                }
              />

              <label className="inline-flex items-center gap-2 bg-[#252525] text-white">
                <input
                  type="checkbox"
                  checked={editForm.active}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, active: e.target.checked }))
                  }
                />
                Active
              </label>

              <label className="inline-flex items-center gap-2 bg-[#252525] text-white">
                <input
                  type="checkbox"
                  checked={editForm.paid}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, paid: e.target.checked }))
                  }
                />
                Paid
              </label>
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button
                className="px-4 py-2 border rounded"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 rounded bg-blue-600 text-white"
                onClick={async () => {
                  if (!editForm.name.trim()) {
                    alert("Name is required");
                    return;
                  }
                  if (!isValidNANP(editForm.phoneNumber)) {
                    alert(
                      "Invalid phone number. Enter 10 digits, or 11 starting with 1."
                    );
                    return;
                  }
                  const phoneE164 = toE164(editForm.phoneNumber);
                  if (!phoneE164) {
                    alert("Invalid phone number format.");
                    return;
                  }
                  const now = new Date();
                  const sel = new Date(`${editForm.date}T${editForm.time}`);
                  if (sel < now) {
                    alert("Appointment cannot be in the past.");
                    return;
                  }
                  try {
                    const payload = {
                      name: editForm.name.trim(),
                      phoneNumber: phoneE164,
                      email: editForm.email.trim() || null,
                      date: editForm.date,
                      time: editForm.time + ":00",
                      duration: Number(editForm.duration),
                      type: editForm.type,
                      comments: editForm.comments || null,
                      active: editForm.active,
                      paid: editForm.paid,
                    };

                    if (!editing) return;

                    const res = await fetch(`/api/appointments/${editing.id}`, {
                      method: "PUT",
                      credentials: "include",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(payload),
                    });

                    if (res.ok) {
                      const updated = await res.json();
                      setAllAppointments((prev) =>
                        prev.map((a) => (a.id === updated.id ? updated : a))
                      );
                      setEditing(null);
                    } else if (res.status === 409) {
                      alert("This time conflicts with another appointment.");
                    } else {
                      const txt = await res.text();
                      console.error("Update failed:", res.status, txt);
                      alert("Failed to update appointment.");
                    }
                  } catch (err) {
                    console.error("Update error:", err);
                    alert("Error updating appointment.");
                  }
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AllAppointments;
