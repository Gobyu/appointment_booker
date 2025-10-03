import React, { useEffect, useMemo, useState } from "react";

// type & utils stay the same
type Review = {
  ReviewID: number;
  Rating: number; // 1-5
  TypeOfMassage: string;
  Comments?: string | null;
  CreatedAt?: string | null; // ISO string
};

type SortKey = "newest" | "highest" | "lowest";

const pageSizeDefault = 5;

const onlyDigits = (s: string) => s.replace(/\D/g, "");

const toE164 = (raw: string): string | null => {
  const d = onlyDigits(raw);
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
};

const isValidEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

function StarRating({ rating }: { rating: number }) {
  const full = Math.max(0, Math.min(5, Math.floor(rating)));
  const stars = "★★★★★".slice(0, full) + "☆☆☆☆☆".slice(0, 5 - full);
  return (
    <span
      className="inline-block select-none font-medium tracking-wider"
      aria-label={`${full} out of 5`}
    >
      <span className="text-yellow-400">{stars.slice(0, full)}</span>
      <span className="text-zinc-600">{stars.slice(full)}</span>
    </span>
  );
}

function Reviews() {
  const [allReviews, setAllReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = pageSizeDefault;

  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    rating: "" as "" | "1" | "2" | "3" | "4" | "5",
    typeOfMassage: "",
    comments: "",
    contact: "",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(`/api/reviews`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: Review[] = await res.json();
        if (!cancelled) {
          setAllReviews(data);
          setCurrentPage(1);
        }
      } catch (err: any) {
        if (!cancelled) setLoadError(err?.message || "Failed to load reviews.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [sortKey]);

  const sorted = useMemo(() => {
    const copy = [...allReviews];
    copy.sort((a, b) => {
      switch (sortKey) {
        case "highest":
          return b.Rating - a.Rating;
        case "lowest":
          return a.Rating - b.Rating;
        case "newest":
        default: {
          const aKey = a.CreatedAt ? Date.parse(a.CreatedAt) : a.ReviewID;
          const bKey = b.CreatedAt ? Date.parse(b.CreatedAt) : b.ReviewID;
          return bKey - aKey;
        }
      }
    });
    return copy;
  }, [allReviews, sortKey]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageItems = sorted.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const onChangeForm = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setFormError(null);
    setFormSuccess(null);
  };

  const validateForm = () => {
    const r = Number(form.rating);
    if (!r || r < 1 || r > 5) return "Please choose a rating from 1 to 5.";
    if (!form.typeOfMassage.trim()) return "Please enter the type of massage.";
    if (form.typeOfMassage.length > 50)
      return "Type of massage must be at most 50 characters.";
    if (form.comments.length > 500)
      return "Comments must be at most 500 characters.";

    const contact = form.contact.trim();
    if (!contact) return "Please enter your phone number or email.";
    const contactValid = isValidEmail(contact) || !!toE164(contact);
    if (!contactValid)
      return "Enter a valid email or a 10/11-digit North American phone number.";

    return null;
  };

  // Verify reviewer has a completed appointment (active=0) by email/phone
  const verifyReviewer = async () => {
    const contact = form.contact.trim();
    if (!contact) return false;

    const tries: string[] = [];

    if (isValidEmail(contact)) {
      const q = new URLSearchParams({ active: "0", email: contact });
      tries.push(`/appointments?${q.toString()}`);
    } else {
      const e164 = toE164(contact);
      if (e164) {
        const q1 = new URLSearchParams({ active: "0", phoneNumber: e164 });
        tries.push(`/appointments?${q1.toString()}`);
      }
      const q2 = new URLSearchParams({ active: "0", phoneNumber: contact });
      tries.push(`/appointments?${q2.toString()}`);

      const digits = onlyDigits(contact);
      if (digits) {
        const q3 = new URLSearchParams({ active: "0", phoneNumber: digits });
        tries.push(`/appointments?${q3.toString()}`);
      }
    }

    for (const url of tries) {
      const res = await fetch(url, { credentials: "include" });
      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows) && rows.length > 0) return true;
      }
    }
    return false;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    const err = validateForm();
    if (err) {
      setFormError(err);
      return;
    }

    try {
      setSubmitting(true);

      const ok = await verifyReviewer();
      if (!ok) {
        setFormError(
          "We couldn’t verify a completed appointment for that phone/email. If you think this is a mistake, please contact us."
        );
        return;
      }

      const payload = {
        Rating: Number(form.rating),
        TypeOfMassage: form.typeOfMassage.trim(),
        Comments: form.comments.trim() || null,
        phoneOrEmail: form.contact.trim(),
      };

      const res = await fetch(`/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Submit failed (HTTP ${res.status})`);
      const created: Review = await res.json();

      setAllReviews((prev) => [created, ...prev]);
      setForm({ rating: "", typeOfMassage: "", comments: "", contact: "" });
      setFormSuccess("Thanks! Your review has been submitted.");
    } catch (err: any) {
      setFormError(
        err?.message ?? "Something went wrong submitting your review."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6 text-white">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-center">Reviews</h1>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <label htmlFor="sort" className="text-sm text-zinc-300">
            Sort by:
          </label>
          <select
            id="sort"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white"
          >
            <option className="bg-zinc-800" value="newest">
              Newest
            </option>
            <option className="bg-zinc-800" value="highest">
              Highest rating
            </option>
            <option className="bg-zinc-800" value="lowest">
              Lowest rating
            </option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
          >
            Prev
          </button>
          <span className="text-sm text-zinc-400">
            Page <span className="font-medium">{currentPage}</span> of{" "}
            <span className="font-medium">{totalPages}</span>
          </span>
          <button
            className="px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
          >
            Next
          </button>
        </div>
      </div>

      <div className="grid gap-4">
        {loading ? (
          <div className="text-center text-zinc-400">Loading reviews…</div>
        ) : loadError ? (
          <div className="text-center text-rose-300">{loadError}</div>
        ) : pageItems.length === 0 ? (
          <div className="text-center text-zinc-400">No reviews yet.</div>
        ) : (
          pageItems.map((r) => (
            <article
              key={r.ReviewID}
              className="rounded-lg border border-zinc-700 bg-zinc-800 p-4 shadow-sm"
            >
              <div className="flex items-start justify-between">
                <h3 className="text-lg font-semibold text-white">
                  {r.TypeOfMassage}
                </h3>
                <div className="ml-4 shrink-0">
                  <StarRating rating={r.Rating} />
                </div>
              </div>
              {r.CreatedAt && (
                <p className="mt-1 text-xs text-zinc-400">
                  {new Date(r.CreatedAt).toLocaleString()}
                </p>
              )}
              {r.Comments ? (
                <p className="mt-3 whitespace-pre-line break-words text-zinc-100">
                  {r.Comments}
                </p>
              ) : (
                <p className="mt-3 italic text-zinc-400">No comments.</p>
              )}
            </article>
          ))
        )}
      </div>

      <h1 className="text-3xl font-bold text-center">Leave us a review!</h1>
      <section className="mt-10 rounded-lg border border-zinc-700 bg-zinc-800 p-6 shadow-sm">
        {formError && (
          <div className="mt-3 rounded-md border border-rose-500/30 bg-rose-900/30 px-3 py-2 text-rose-200">
            {formError}
          </div>
        )}
        {formSuccess && (
          <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-900/30 px-3 py-2 text-emerald-200">
            {formSuccess}
          </div>
        )}

        <form className="mt-4 grid gap-4" onSubmit={onSubmit}>
          <div className="grid gap-2">
            <label
              htmlFor="typeOfMassage"
              className="text-sm font-medium text-zinc-200"
            >
              Type of Massage *
            </label>
            <input
              id="typeOfMassage"
              name="typeOfMassage"
              value={form.typeOfMassage}
              onChange={onChangeForm}
              maxLength={50}
              required
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
              placeholder="e.g., Back Massage"
            />
          </div>

          <div className="grid gap-4">
            <label className="text-sm font-medium text-zinc-200">
              Rating *
            </label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((num) => (
                <label key={num}>
                  <input
                    type="radio"
                    name="rating"
                    value={num}
                    checked={form.rating === String(num)}
                    onChange={onChangeForm}
                    className="peer hidden"
                    required
                  />
                  <span
                    className="
                      cursor-pointer rounded-full px-4 py-2 text-sm font-medium transition
                      border border-zinc-700 
                      peer-checked:bg-blue-600 peer-checked:text-white peer-checked:border-blue-600
                      bg-zinc-900 text-zinc-300 hover:bg-zinc-700
                    "
                  >
                    {num} ★
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <label
              htmlFor="contact"
              className="text-sm font-medium text-zinc-200"
            >
              Phone number or Email (required)
            </label>
            <input
              id="contact"
              name="contact"
              value={form.contact}
              onChange={onChangeForm}
              required
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
              placeholder="e.g., 444-555-6666 or name@example.com"
            />
          </div>

          <div className="grid gap-2">
            <label
              htmlFor="comments"
              className="text-sm font-medium text-zinc-200"
            >
              Comments (optional)
            </label>
            <textarea
              id="comments"
              name="comments"
              value={form.comments}
              onChange={onChangeForm}
              maxLength={500}
              rows={4}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
              placeholder="Tell us about your experience…"
            />
            <div className="text-xs text-zinc-400">
              {form.comments.length}/500
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="reset"
              className="rounded-md border border-zinc-700 bg-zinc-800 px-4 py-2 text-zinc-200 hover:bg-zinc-700"
              onClick={() => {
                setForm({
                  rating: "",
                  typeOfMassage: "",
                  comments: "",
                  contact: "",
                });
                setFormError(null);
                setFormSuccess(null);
              }}
            >
              Clear
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-500 disabled:opacity-60"
            >
              {submitting ? "Submitting…" : "Submit"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default Reviews;
