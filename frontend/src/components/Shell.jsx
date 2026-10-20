import { NavLink, Outlet } from "react-router-dom";
import { canApprove, canProcess, getUser, saveUserId, config } from "../lib/config";

export default function Shell({ userId, onUserChange, toast }) {
  const user = getUser(userId);

  return (
    <div className="app-shell">
      <header className="topnav">
        <NavLink to="/" className="brand-lockup">
          <img src="/logo.png" alt="Saudi Cargo" />
          <div className="brand-copy">
            <strong>AP Console</strong>
            <span>Invoice desk</span>
          </div>
        </NavLink>

        <nav className="nav-links" aria-label="Main">
          <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            Home
          </NavLink>
          {canProcess(user) && (
            <NavLink to="/upload" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
              Upload
            </NavLink>
          )}
          {canApprove(user) && (
            <NavLink to="/?focus=review" className="nav-link">
              Review
            </NavLink>
          )}
        </nav>

        <label className="user-chip">
          <span className="muted" style={{ fontSize: "0.78rem" }}>
            Acting as
          </span>
          <select
            value={userId}
            onChange={(e) => {
              saveUserId(e.target.value);
              onUserChange(e.target.value);
            }}
            aria-label="Switch user"
          >
            {config.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {u.roleLabel}
              </option>
            ))}
          </select>
        </label>
      </header>

      <main className="main">
        <Outlet />
      </main>

      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
