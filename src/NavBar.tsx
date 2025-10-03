import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "./AuthContext";

const NavBar = () => {
  const [open, setOpen] = useState(false);
  const { user, logout } = useAuth(); // user is null or { id, email, role }

  const isAdmin = user?.role === "admin";

  return (
    <nav className="fixed top-0 left-0 w-full bg-[#1a1a1a] text-white shadow z-50">
      <div className="mx-auto max-w-7xl px-4 h-20 flex items-center justify-between">
        <div className="text-2xl font-bold">
          <Link to="/">赵永按摩</Link>
        </div>

        {/* Desktop links */}
        <div className="hidden md:flex flex-1 justify-center space-x-8 text-lg">
          <Link to="/About" className="hover:text-zinc-300">
            About
          </Link>
          <Link to="/Reviews" className="hover:text-zinc-300">
            Reviews
          </Link>
          <Link to="/BookAppointment" className="hover:text-zinc-300">
            Book Appointment
          </Link>

          {/* Only show to logged-in admins */}
          {isAdmin && (
            <Link to="/AllAppointments" className="hover:text-zinc-300">
              All Appointments
            </Link>
          )}
          {isAdmin && (
            <Link to="/Management" className="hover:text-zinc-300">
              Manage
            </Link>
          )}
        </div>

        {/* Right side: Login/Logout */}
        <div className="hidden md:flex items-center gap-3">
          {!user ? (
            <Link to="/login" className="px-3 py-2 rounded hover:bg-white/10">
              Login
            </Link>
          ) : (
            <>
              <span className="text-sm text-zinc-300">{user.email}</span>
              <button
                onClick={async () => {
                  await fetch("/auth/logout", {
                    method: "POST",
                    credentials: "include",
                  });
                  logout(); // clear auth state in context
                }}
                className="px-3 py-2 rounded hover:bg-white/10"
              >
                Logout
              </button>
            </>
          )}
        </div>

        {/* Mobile menu button */}
        <button
          className="md:hidden inline-flex items-center px-3 py-2 rounded hover:bg-white/10"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav"
        >
          <svg
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            {open ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile dropdown */}
      <div
        id="mobile-nav"
        className={`md:hidden overflow-hidden transition-[max-height] duration-300 ${
          open ? "max-h-64" : "max-h-0"
        }`}
      >
        <div className="px-4 pb-3 flex flex-col space-y-2">
          <Link to="/About" className="py-2 border-b border-white/10">
            About
          </Link>
          <Link to="/Reviews" className="py-2 border-b border-white/10">
            Reviews
          </Link>
          <Link to="/BookAppointment" className="py-2 border-b border-white/10">
            Book Appointment
          </Link>

          {/* Only show to logged-in admins */}
          {isAdmin && (
            <Link
              to="/AllAppointments"
              className="py-2 border-b border-white/10"
            >
              All Appointments
            </Link>
          )}

          {!user ? (
            <Link to="/login" className="py-2">
              Login
            </Link>
          ) : (
            <button
              onClick={async () => {
                await fetch("/auth/logout", {
                  method: "POST",
                  credentials: "include",
                });
                logout(); // clear auth state in context (match desktop behavior)
              }}
              className="text-left py-2"
            >
              Logout
            </button>
          )}
        </div>
      </div>
    </nav>
  );
};

export default NavBar;
