import { NavLink, Outlet } from "react-router-dom";
import { canApprove, canProcess, getUser, saveUserId, config } from "../lib/config";

export default function Shell({ userId, onUserChange, toast }) {
  const user = getUser(userId);

  return (
    <div className="app-shell">
      <header className="topnav">
        <NavLink to="/" className="brand-lockup">
          <img src="/logo.svg" alt="" width={36} height={36} />
          <div className="brand-copy">
            <strong>ClearDesk</strong>
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
            <NavLink
              to="/?focus=review"
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
            >
              Review
            </NavLink>
          )}
        </nav>

        <label className="user-chip">
          <span className="muted user-chip__label">Role</span>
          <select
            value={userId}
            onChange={(e) => {
              saveUserId(e.target.value);
              onUserChange(e.target.value);
            }}
            aria-label="Switch role"
          >
            {config.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.roleLabel}
              </option>
            ))}
          </select>
        </label>
      </header>

      <main className="main">
        <Outlet />
      </main>

      <footer className="site-footer">
        <span>ClearDesk</span>
        <span className="muted">Invoice automation</span>
      </footer>

      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
