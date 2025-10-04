// Express on Vercel (serverless) with MySQL pooling + MySQL session store

const express = require("express");
const mysql = require("mysql2"); // <-- keep ONLY this one
const cors = require("cors");
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const bcrypt = require("bcryptjs");
const serverless = require("serverless-http");

// ---------- Config (all secrets in env) ----------
const {
  DB_HOST,
  DB_PORT,
  DB_USER,
  DB_PASSWORD,
  DB_NAME,
  SESSION_SECRET = "change-me-in-env",
  NODE_ENV,
  CORS_ORIGIN, // optional
} = process.env;

// ---- DB POOL (SSL-friendly for Aiven) ----
const ssl =
  process.env.DB_CA_CERT && process.env.DB_CA_CERT.trim()
    ? { ca: process.env.DB_CA_CERT }
    : { rejectUnauthorized: true };

const pool =
  global.__MYSQL_POOL__ ||
  mysql.createPool({
    host: DB_HOST,
    port: DB_PORT ? Number(DB_PORT) : 3306,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    ssl,
  });
if (!global.__MYSQL_POOL__) global.__MYSQL_POOL__ = pool;

// Session store uses same pool
const sessionStore = global.__SESSION_STORE__ || new MySQLStore({}, pool);
if (!global.__SESSION_STORE__) global.__SESSION_STORE__ = sessionStore;

// A tiny helper that runs a ping once per container spin-up (optional)
function pingOnce() {
  if (global.__PINGED__) return;
  pool.query("SELECT 1", () => {});
  global.__PINGED__ = true;
}
pingOnce();

// ---------- App ----------
const app = express();
app.set("trust proxy", 1);

// SAFE permissive CORS for specified origin(s)
const allowedOrigins = [CORS_ORIGIN, "http://localhost:5173"].filter(Boolean);
app.use(
  cors({
    origin: (origin, cb) => {
      // allow same-origin or no-origin (SSR/curl) without error
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      // instead of error -> deny CORS silently (no headers) to avoid 500
      return cb(null, false);
    },
    credentials: true,
  })
);

app.use(express.json());

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: NODE_ENV === "production", // true on Vercel prod
      maxAge: 1000 * 60 * 60 * 8, // 8h
    },
  })
);
app.get("/api/dbcheck", (req, res) => {
  pool.query("SELECT DATABASE() AS db", (err, rows) => {
    if (err) return res.status(500).json({ error: err.code || String(err), detail: err.message });
    res.json({ connectedTo: rows?.[0]?.db || null });
  });
});

// ---------- Helpers ----------
function onlyDigits(s) {
  return String(s || "").replace(/\D/g, "");
}
function normalizeNANPTo10(raw) {
  const d = onlyDigits(raw || "");
  if (d.length === 10) return d;
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  return null;
}
function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.status(401).json({ message: "Not authenticated" });
}
function requireRole(role) {
  return (req, res, next) => {
    if (req.session?.user?.role === role) return next();
    return res.status(403).json({ message: "Forbidden" });
  };
}
function isISODate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}
function normalizeTimeHHMMSS(t) {
  // accepts "HH:MM" or "HH:MM:SS" -> returns "HH:MM:SS" or null
  if (!t) return null;
  const s = String(t);
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(s)) return null;
  return s.length === 5 ? `${s}:00` : s;
}
function isValidWeekday(n) {
  return Number.isInteger(n) && n >= 1 && n <= 7;
}
function toHHMM(timeStr) {
  return String(timeStr || "").slice(0, 5);
}
function addMinutesHHMM(hhmm, mins) {
  const [H, M] = hhmm.split(":").map(Number);
  const total = H * 60 + M + mins;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function jsWeekdayMonday1to7(dateISO) {
  // JS: 0=Sun..6=Sat -> convert to 1=Mon..7=Sun
  const d = new Date(`${dateISO}T00:00:00`);
  const n = d.getDay(); // 0..6
  return n === 0 ? 7 : n; // Mon=1..Sun=7
}

// ---------- ROUTES (unchanged logic, but using pool) ----------

// Availability
app.get("/api/availability", (req, res) => {
  try {
    const date = req.query.date;
    const slotMinutes = Math.max(5, parseInt(req.query.slotMinutes, 10) || 30);
    const excludeId = Number.isInteger(parseInt(req.query.excludeId, 10))
      ? parseInt(req.query.excludeId, 10)
      : null;

    if (!isISODate(date)) {
      return res.status(400).json({ error: "date must be YYYY-MM-DD" });
    }

    const holidaySql = `
      SELECT id, holiday, comment, is_open, start_time, end_time
      FROM holiday_hours
      WHERE start_date <= ?
        AND COALESCE(end_date, start_date) >= ?
      ORDER BY
        (COALESCE(end_date, start_date) = start_date) DESC,
        DATEDIFF(COALESCE(end_date, start_date), start_date) ASC,
        id ASC
      LIMIT 1
    `;

    pool.query(holidaySql, [date, date], (hErr, hRows) => {
      if (hErr) {
        console.error("availability holiday-range query error:", hErr);
        return res.status(500).json({ error: "Database error" });
      }

      const useHoliday = hRows && hRows.length > 0;
      if (useHoliday && hRows[0].is_open === 0) {
        return res.json({
          date,
          slotMinutes,
          times: [],
          holidayLabel: hRows[0].holiday || null,
          holidayComment: hRows[0].comment || null,
          isOpenOverride: false,
        });
      }

      const handleWithWindow = (startTimeStr, endTimeStr, meta = null) => {
        if (!startTimeStr || !endTimeStr) {
          return res.json({
            date,
            slotMinutes,
            times: [],
            ...(meta || {}),
          });
        }
        let start = toHHMM(startTimeStr);
        let end = toHHMM(endTimeStr);

        // candidates
        const candidates = [];
        for (
          let t = start;
          addMinutesHHMM(t, slotMinutes) <= end;
          t = addMinutesHHMM(t, slotMinutes)
        ) {
          candidates.push(t);
        }

        // remove past if today
        const now = new Date();
        const isToday =
          new Date(`${date}T00:00:00`).toDateString() === now.toDateString();
        const future = isToday
          ? candidates.filter((t) => new Date(`${date}T${t}:00`) > now)
          : candidates;

        if (future.length === 0) {
          return res.json({ date, slotMinutes, times: [], ...(meta || {}) });
        }

        const apptSql = `
          SELECT id, time, duration
          FROM appointments
          WHERE date = ?
        `;
        pool.query(apptSql, [date], (aErr, aRows) => {
          if (aErr) {
            console.error("availability appointments query error:", aErr);
            return res.status(500).json({ error: "Database error" });
          }

          const existing = (aRows || []).map((r) => ({
            start: toHHMM(r.time),
            end: addMinutesHHMM(toHHMM(r.time), Number(r.duration) || 0),
          }));

          const overlaps = (s, e, S, E) => s < E && e > S;

          const free = future.filter((t) => {
            const endT = addMinutesHHMM(t, slotMinutes);
            for (const ex of existing) {
              if (overlaps(t, endT, ex.start, ex.end)) return false;
            }
            return true;
          });

          return res.json({
            date,
            slotMinutes,
            times: free,
            ...(meta || {}),
          });
        });
      };

      if (useHoliday && hRows[0].is_open === 1) {
        return handleWithWindow(hRows[0].start_time, hRows[0].end_time, {
          holidayLabel: hRows[0].holiday || null,
          holidayComment: hRows[0].comment || null,
          isOpenOverride: true,
        });
      }

      const weekDay = jsWeekdayMonday1to7(date);
      const bizSql = `
        SELECT start_time, end_time
        FROM business_hours
        WHERE week_day = ?
        LIMIT 1
      `;
      pool.query(bizSql, [weekDay], (bErr, bRows) => {
        if (bErr) {
          console.error("availability business hours query error:", bErr);
          return res.status(500).json({ error: "Database error" });
        }
        if (!bRows || bRows.length === 0) {
          return res.json({ date, slotMinutes, times: [] });
        }
        return handleWithWindow(bRows[0].start_time, bRows[0].end_time);
      });
    });
  } catch (e) {
    console.error("GET /api/availability error:", e);
    res.status(500).json({ error: "Unexpected error" });
  }
});

// ---- Admin: update appointment ----
app.put(
  "/api/appointments/:id",
  requireAuth,
  requireRole("admin"),
  (req, res) => {
    const apptId = Number(req.params.id);
    if (!Number.isInteger(apptId) || apptId <= 0) {
      return res.status(400).json({ message: "Invalid appointment id" });
    }

    const {
      name,
      phoneNumber,
      email,
      date,
      time,
      duration,
      type,
      comments,
      active,
      paid,
    } = req.body || {};

    if (!name || !date || !time || !duration || !type) {
      return res.status(400).json({ message: "Missing required fields" });
    }
    const dur = Number(duration);
    if (!Number.isInteger(dur) || ![30, 60].includes(dur)) {
      return res
        .status(400)
        .json({ message: "Duration must be 30 or 60 minutes" });
    }

    let phone10 = null;
    if (phoneNumber != null && phoneNumber !== "") {
      phone10 = normalizeNANPTo10(phoneNumber);
      if (!phone10) {
        return res.status(400).json({ message: "Invalid phone number" });
      }
    }

    const startHHMM = String(time).slice(0, 5);
    const selectedDateTime = new Date(`${date}T${startHHMM}`);
    if (isNaN(selectedDateTime.getTime())) {
      return res.status(400).json({ message: "Invalid date/time" });
    }
    if (selectedDateTime < new Date()) {
      return res
        .status(400)
        .json({ message: "Appointment cannot be in the past" });
    }

    const conflictSql = `
    SELECT id
    FROM appointments
    WHERE date = ?
      AND id <> ?
      AND TIME(?) < ADDTIME(time, SEC_TO_TIME(duration*60))
      AND ADDTIME(TIME(?), SEC_TO_TIME(?*60)) > time
    LIMIT 1
  `;
    pool.query(
      conflictSql,
      [date, apptId, startHHMM, startHHMM, dur],
      (err, rows) => {
        if (err) {
          console.error("Conflict check error:", err);
          return res.status(500).json({ message: "Database error" });
        }
        if (rows.length > 0) {
          return res
            .status(409)
            .json({ message: "Time conflict with another appointment" });
        }

        const fields = [];
        const params = [];
        fields.push(
          "name = ?",
          "email = ?",
          "date = ?",
          "time = ?",
          "duration = ?",
          "type = ?",
          "comments = ?"
        );
        params.push(
          name,
          email || null,
          date,
          `${startHHMM}:00`,
          dur,
          type,
          comments || null
        );

        if (phone10 !== null) {
          fields.push("phoneNumber = ?");
          params.push(phone10);
        }
        if (active !== undefined) {
          fields.push("active = ?");
          params.push(Number(active ? 1 : 0));
        }
        if (paid !== undefined) {
          fields.push("paid = ?");
          params.push(Number(paid ? 1 : 0));
        }

        params.push(apptId);

        const updateSql = `UPDATE appointments SET ${fields.join(
          ", "
        )} WHERE id = ?`;
        pool.query(updateSql, params, (uErr) => {
          if (uErr) {
            console.error("UPDATE /api/appointments/:id error:", uErr);
            return res
              .status(500)
              .json({ message: "Failed to update appointment" });
          }
          pool.query(
            "SELECT * FROM appointments WHERE id = ?",
            [apptId],
            (sErr, rows2) => {
              if (sErr) {
                console.error("SELECT after update error:", sErr);
                return res
                  .status(500)
                  .json({ message: "Updated but failed to fetch" });
              }
              res.json(rows2[0]);
            }
          );
        });
      }
    );
  }
);

// ---- Admin: list appointments ----
app.get("/api/appointments", requireAuth, requireRole("admin"), (req, res) => {
  const filters = req.query;

  let query = "SELECT * FROM appointments";
  const conditions = [];
  const params = [];

  for (const key in filters) {
    if (
      Object.hasOwnProperty.call(filters, key) &&
      [
        "id",
        "name",
        "phoneNumber",
        "email",
        "date",
        "time",
        "duration",
        "type",
        "comments",
        "active",
        "paid",
      ].includes(key)
    ) {
      conditions.push(`${key} = ?`);
      params.push(filters[key]);
    }
  }

  if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY date ASC, time ASC";

  let limitClause = "";
  if (filters.limit) {
    const lim = Number(filters.limit);
    if (Number.isInteger(lim) && lim > 0) {
      limitClause = " LIMIT ?";
      params.push(lim);
    }
  }

  pool.query(query + limitClause, params, (err, results) => {
    if (err) {
      console.error("GET /api/appointments error:", err);
      return res.status(500).json({ message: "Database error" });
    }
    res.json(results);
  });
});

// ---- Business hours (admin) ----
app.get(
  "/api/admin/business-hours",
  requireAuth,
  requireRole("admin"),
  (req, res) => {
    const sql = `
    SELECT
      week_day,
      DATE_FORMAT(start_time, '%H:%i') AS start_time,
      DATE_FORMAT(end_time,   '%H:%i') AS end_time,
      is_open
    FROM business_hours
    ORDER BY week_day ASC
  `;
    pool.query(sql, [], (err, rows) => {
      if (err) {
        console.error("GET /api/admin/business-hours error:", err);
        return res.status(500).json({ error: "Failed to load business hours" });
      }
      res.json(rows);
    });
  }
);

app.put(
  "/api/admin/business-hours/:week_day",
  requireAuth,
  requireRole("admin"),
  (req, res) => {
    const day = Number(req.params.week_day);
    if (!isValidWeekday(day)) {
      return res.status(400).json({ error: "week_day must be 1..7" });
    }

    const isOpen = !!req.body?.is_open;
    const start =
      req.body?.start_time != null
        ? normalizeTimeHHMMSS(req.body.start_time)
        : null;
    const end =
      req.body?.end_time != null
        ? normalizeTimeHHMMSS(req.body.end_time)
        : null;

    if (isOpen) {
      if (!start || !end)
        return res.status(400).json({
          error: "When is_open is true, start_time and end_time are required",
        });
      if (start >= end)
        return res
          .status(400)
          .json({ error: "start_time must be before end_time" });
    }

    const sql = `
    INSERT INTO business_hours (week_day, start_time, end_time, is_open)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      start_time = VALUES(start_time),
      end_time   = VALUES(end_time),
      is_open    = VALUES(is_open)
  `;
    pool.query(sql, [day, start, end, isOpen ? 1 : 0], (err) => {
      if (err) {
        console.error("PUT /api/admin/business-hours/:week_day error:", err);
        return res.status(500).json({ error: "Failed to save" });
      }
      res.json({ ok: true });
    });
  }
);

app.delete(
  "/api/admin/business-hours/:week_day",
  requireAuth,
  requireRole("admin"),
  (req, res) => {
    const day = Number(req.params.week_day);
    if (!isValidWeekday(day)) {
      return res.status(400).json({ error: "week_day must be 1..7" });
    }
    const sql = `
    INSERT INTO business_hours (week_day, is_open)
    VALUES (?, 0)
    ON DUPLICATE KEY UPDATE
      is_open = VALUES(is_open)
  `;
    pool.query(sql, [day], (err) => {
      if (err) {
        console.error(
          "DELETE(toggles close) /api/admin/business-hours/:week_day error:",
          err
        );
        return res.status(500).json({ error: "Failed to close weekday" });
      }
      res.json({ ok: true });
    });
  }
);

// ---- Holiday overrides (ranged) ----
app.get(
  "/api/admin/holiday-hours",
  requireAuth,
  requireRole("admin"),
  (req, res) => {
    const { from, to } = req.query || {};
    if (!isISODate(from) || !isISODate(to)) {
      return res
        .status(400)
        .json({ error: "from and to (YYYY-MM-DD) are required" });
    }
    const sql = `
    SELECT id,
           DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
           DATE_FORMAT(end_date,   '%Y-%m-%d') AS end_date,
           holiday,
           comment,
           (is_open + 0) AS is_open,
           DATE_FORMAT(start_time, '%H:%i') AS start_time,
           DATE_FORMAT(end_time,   '%H:%i') AS end_time
    FROM holiday_hours
    WHERE NOT (COALESCE(end_date, start_date) < ? OR start_date > ?)
    ORDER BY start_date ASC, COALESCE(end_date, start_date) ASC, id ASC
  `;
    pool.query(sql, [from, to], (err, rows) => {
      if (err) {
        console.error("GET /api/admin/holiday-hours (ranged) error:", err);
        return res.status(500).json({ error: "Failed to load holiday hours" });
      }
      const normalized = rows.map((r) => ({ ...r, is_open: r.is_open === 1 }));
      res.json(normalized);
    });
  }
);

app.post(
  "/api/admin/holiday-hours",
  requireAuth,
  requireRole("admin"),
  (req, res) => {
    const {
      start_date,
      end_date = null,
      holiday,
      comment = null,
      is_open,
      start_time,
      end_time,
    } = req.body || {};
    if (!isISODate(start_date))
      return res.status(400).json({ error: "start_date must be YYYY-MM-DD" });
    if (end_date && !isISODate(end_date))
      return res.status(400).json({ error: "end_date must be YYYY-MM-DD" });
    if (!holiday || !String(holiday).trim())
      return res.status(400).json({ error: "holiday is required" });

    const open = !!is_open;
    const st = open ? normalizeTimeHHMMSS(start_time) : null;
    const et = open ? normalizeTimeHHMMSS(end_time) : null;

    if (open) {
      if (!st || !et)
        return res.status(400).json({
          error: "start_time and end_time required when is_open=true",
        });
      if (st >= et)
        return res
          .status(400)
          .json({ error: "start_time must be before end_time" });
    }
    if (end_date && end_date < start_date) {
      return res
        .status(400)
        .json({ error: "end_date must be on/after start_date" });
    }

    const sql = `
    INSERT INTO holiday_hours
      (start_date, end_date, holiday, comment, is_open, start_time, end_time)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
    pool.query(
      sql,
      [
        start_date,
        end_date,
        String(holiday).trim(),
        comment ? String(comment).trim() : null,
        open ? 1 : 0,
        st,
        et,
      ],
      (err, result) => {
        if (err) {
          console.error("POST /api/admin/holiday-hours error:", err);
          return res.status(500).json({ error: "Failed to save holiday" });
        }
        res.json({ ok: true, id: result.insertId });
      }
    );
  }
);

app.put(
  "/api/admin/holiday-hours/:id",
  requireAuth,
  requireRole("admin"),
  (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0)
      return res.status(400).json({ error: "Invalid id" });

    const {
      start_date,
      end_date = null,
      holiday,
      comment = null,
      is_open,
      start_time,
      end_time,
    } = req.body || {};
    if (!isISODate(start_date))
      return res.status(400).json({ error: "start_date must be YYYY-MM-DD" });
    if (end_date && !isISODate(end_date))
      return res.status(400).json({ error: "end_date must be YYYY-MM-DD" });
    if (!holiday || !String(holiday).trim())
      return res.status(400).json({ error: "holiday is required" });

    const open = !!is_open;
    const st = open ? normalizeTimeHHMMSS(start_time) : null;
    const et = open ? normalizeTimeHHMMSS(end_time) : null;

    if (open) {
      if (!st || !et)
        return res.status(400).json({
          error: "start_time and end_time required when is_open=true",
        });
      if (st >= et)
        return res
          .status(400)
          .json({ error: "start_time must be before end_time" });
    }
    if (end_date && end_date < start_date) {
      return res
        .status(400)
        .json({ error: "end_date must be on/after start_date" });
    }

    const sql = `
    UPDATE holiday_hours
       SET start_date = ?, end_date = ?, holiday = ?, comment = ?, is_open = ?,
           start_time = ?, end_time = ?
     WHERE id = ?
  `;
    pool.query(
      sql,
      [
        start_date,
        end_date,
        String(holiday).trim(),
        comment ? String(comment).trim() : null,
        open ? 1 : 0,
        st,
        et,
        id,
      ],
      (err, result) => {
        if (err) {
          console.error("PUT /api/admin/holiday-hours/:id error:", err);
          return res.status(500).json({ error: "Failed to update holiday" });
        }
        if (!result || result.affectedRows === 0)
          return res.status(404).json({ error: "Not found" });
        res.json({ ok: true });
      }
    );
  }
);

app.delete(
  "/api/admin/holiday-hours/:id",
  requireAuth,
  requireRole("admin"),
  (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0)
      return res.status(400).json({ error: "Invalid id" });

    pool.query(
      `DELETE FROM holiday_hours WHERE id = ?`,
      [id],
      (err, result) => {
        if (err) {
          console.error("DELETE /api/admin/holiday-hours/:id error:", err);
          return res.status(500).json({ error: "Failed to delete holiday" });
        }
        if (!result || result.affectedRows === 0)
          return res.status(404).json({ error: "Not found" });
        res.json({ ok: true });
      }
    );
  }
);

// Public holiday info (note: your original query used `WHERE date = ?` but table is ranged)
// Here we answer “what applies on this date?” by checking inclusion in range.
app.get("/api/holiday-info", (req, res) => {
  const date = req.query.date;
  if (!isISODate(date))
    return res.status(400).json({ error: "date must be YYYY-MM-DD" });

  const sql = `
    SELECT holiday, comment, (is_open + 0) AS is_open,
           DATE_FORMAT(start_time, '%H:%i') AS start_time,
           DATE_FORMAT(end_time,   '%H:%i') AS end_time
    FROM holiday_hours
    WHERE start_date <= ?
      AND COALESCE(end_date, start_date) >= ?
    ORDER BY
      (COALESCE(end_date, start_date) = start_date) DESC,
      DATEDIFF(COALESCE(end_date, start_date), start_date) ASC,
      id ASC
    LIMIT 1
  `;
  pool.query(sql, [date, date], (err, rows) => {
    if (err) {
      console.error("GET /api/holiday-info error:", err);
      return res.status(500).json({ error: "Database error" });
    }
    if (!rows || rows.length === 0) return res.json({ exists: false });
    const r = rows[0];
    return res.json({
      exists: true,
      holiday: r.holiday,
      comment: r.comment,
      is_open: r.is_open === 1,
      start_time: r.start_time,
      end_time: r.end_time,
    });
  });
});

// ---- Public: create appointment ----
app.post("/api/BookAppointment", (req, res) => {
  const { name, phoneNumber, email, date, time, duration, type, comments } =
    req.body || {};

  if (!name || !date || !time || !duration || !type) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  const dur = Number(duration);
  if (!Number.isInteger(dur) || ![30, 60].includes(dur)) {
    return res
      .status(400)
      .json({ message: "Duration must be 30 or 60 minutes" });
  }

  const phone10 =
    phoneNumber != null && phoneNumber !== ""
      ? normalizeNANPTo10(phoneNumber)
      : null;
  if (phoneNumber && !phone10) {
    return res.status(400).json({ message: "Invalid phone number" });
  }

  const startHHMM = String(time).slice(0, 5);
  if (!/^\d{2}:\d{2}$/.test(startHHMM) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ message: "Invalid date/time" });
  }
  const selectedDateTime = new Date(`${date}T${startHHMM}`);
  if (selectedDateTime < new Date()) {
    return res
      .status(400)
      .json({ message: "Appointment cannot be in the past" });
  }

  const conflictSql = `
    SELECT id
    FROM appointments
    WHERE date = ?
      AND TIME(?) < ADDTIME(time, SEC_TO_TIME(duration*60))
      AND ADDTIME(TIME(?), SEC_TO_TIME(?*60)) > time
    LIMIT 1
  `;
  pool.query(conflictSql, [date, startHHMM, startHHMM, dur], (cErr, cRows) => {
    if (cErr) {
      console.error("POST /api/BookAppointment conflict error:", cErr);
      return res.status(500).json({ message: "Database error" });
    }
    if (cRows.length > 0) {
      return res
        .status(409)
        .json({ message: "Time conflict with another appointment" });
    }

    const q = `
      INSERT INTO appointments
      (name, phoneNumber, email, date, time, duration, type, comments, active, paid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0)
    `;
    pool.query(
      q,
      [
        name,
        phone10,
        email || null,
        date,
        `${startHHMM}:00`,
        dur,
        type,
        comments || null,
      ],
      (err) => {
        if (err) {
          console.error("POST /api/BookAppointment insert error:", err);
          return res.status(500).json({ message: "Database error" });
        }
        res.status(200).json({ message: "Appointment saved successfully" });
      }
    );
  });
});

// ---- Reviews ----
app.get("/api/reviews", (req, res) => {
  const limit = parseInt(req.query.limit, 10);
  const baseSql = `
    SELECT ReviewID, Rating, TypeOfMassage, Comments, CreatedAt
    FROM Reviews
    ORDER BY CreatedAt DESC, ReviewID DESC
  `;
  const sql =
    Number.isInteger(limit) && limit > 0 ? `${baseSql} LIMIT ?` : baseSql;
  const params = Number.isInteger(limit) && limit > 0 ? [limit] : [];

  pool.query(sql, params, (err, rows) => {
    if (err) {
      console.error("GET /api/reviews error:", err);
      return res.status(500).json({ error: "Failed to load reviews" });
    }
    res.json(rows);
  });
});

app.post("/api/reviews", (req, res) => {
  try {
    const { Rating, TypeOfMassage, Comments } = req.body || {};

    const ratingNum = Number(Rating);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: "Rating must be an integer 1–5." });
    }
    if (typeof TypeOfMassage !== "string" || !TypeOfMassage.trim()) {
      return res.status(400).json({ error: "TypeOfMassage is required." });
    }
    if (TypeOfMassage.length > 50) {
      return res
        .status(400)
        .json({ error: "TypeOfMassage must be ≤ 50 chars." });
    }
    if (Comments != null && typeof Comments !== "string") {
      return res.status(400).json({ error: "Comments must be a string." });
    }
    if (Comments && Comments.length > 500) {
      return res.status(400).json({ error: "Comments must be ≤ 500 chars." });
    }

    const insertSql = `
      INSERT INTO Reviews (Rating, TypeOfMassage, Comments)
      VALUES (?, ?, ?)
    `;
    pool.query(
      insertSql,
      [ratingNum, TypeOfMassage.trim(), Comments?.trim() || null],
      (err, result) => {
        if (err) {
          console.error("POST /api/reviews insert error:", err);
          return res.status(500).json({ error: "Failed to submit review" });
        }
        const insertedId = result.insertId;

        const selectSql = `
          SELECT ReviewID, Rating, TypeOfMassage, Comments, CreatedAt
          FROM Reviews
          WHERE ReviewID = ?
        `;
        pool.query(selectSql, [insertedId], (err2, rows) => {
          if (err2) {
            console.error("POST /api/reviews select error:", err2);
            return res
              .status(500)
              .json({ error: "Failed to fetch created review" });
          }
          const created = rows?.[0] || null;
          return res.status(201).json(created);
        });
      }
    );
  } catch (e) {
    console.error("POST /api/reviews unexpected error:", e);
    res.status(500).json({ error: "Unexpected error" });
  }
});

// ---- Auth ----
app.post("/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ message: "Missing credentials" });

  pool.query(
    "SELECT id, email, password_hash, role FROM users WHERE email = ? LIMIT 1",
    [email],
    async (err, rows) => {
      if (err) return res.status(500).json({ message: "DB error" });
      const user = rows?.[0];
      if (!user)
        return res.status(401).json({ message: "Invalid email or password" });

      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok)
        return res.status(401).json({ message: "Invalid email or password" });

      req.session.user = { id: user.id, email: user.email, role: user.role };
      res.json({ id: user.id, email: user.email, role: user.role });
    }
  );
});

app.get("/auth/me", (req, res) => {
  res.json(req.session?.user || null);
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid", {
      httpOnly: true,
      sameSite: "lax",
      secure: NODE_ENV === "production",
    });
    res.json({ ok: true });
  });
});

// ---------- Export serverless handler (NO app.listen) ----------
module.exports = serverless(app);
