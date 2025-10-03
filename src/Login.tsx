import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string|null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const res = await fetch('/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (res.ok) {
      await refresh();
      nav('/', { replace: true });
    } else {
      setErr('Invalid email or password');
    }
  };

  return (
    <div className="max-w-sm mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Staff Login</h1>
      {err && <div className="mb-3 text-red-600">{err}</div>}
      <form className="grid gap-3" onSubmit={onSubmit}>
        <input
          className="border rounded px-3 py-2"
          placeholder="Email"
          autoComplete="username"
          value={email}
          onChange={e=>setEmail(e.target.value)}
        />
        <input
          type="password"
          className="border rounded px-3 py-2"
          placeholder="Password"
          autoComplete="current-password"
          value={password}
          onChange={e=>setPassword(e.target.value)}
        />
        <button
          disabled={busy}
          className="rounded bg-blue-600 text-white px-4 py-2 disabled:opacity-60"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
