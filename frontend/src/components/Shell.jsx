import { NavLink, Outlet } from "react-router-dom";
import { canApprove, config, saveUserId } from "../lib/config";
import { signOutUrl } from "../lib/api";

export default function Shell({ userId, onUserChange, toast, session, localUser }) {
  const user = localUser;
  const displayName = session?.name || user?.name || userId;
  const roleLabel =
    (session?.role &&
      config.users.find((u) => u.role === session.role)?.roleLabel) ||
    user?.roleLabel ||
    session?.role ||
    "Role";
  const gatewayAuth = session?.source === "gateway";
  const apiBacked = Boolean(session?.source);

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
          <NavLink
            to="/desk"
            className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
          >
            Desk
          </NavLink>
          {canApprove(user) && (
            <NavLink
              to="/approvals"
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
            >
              Approvals
            </NavLink>
          )}
        </nav>

        <div className="session-chip">
          <div className="session-chip__who" title={session?.email || ""}>
            <span className="muted user-chip__label">Signed in as</span>
            <strong>{displayName}</strong>
            <span className="session-chip__role">{roleLabel}</span>
          </div>
          {gatewayAuth ? (
            <a className="btn btn-ghost btn-compact" href={signOutUrl()}>
              Sign out
            </a>
          ) : (
            <label className="user-chip user-chip--inline">
              <span className="muted user-chip__label">Role</span>
              <select
                value={userId}
                onChange={(e) => {
                  saveUserId(e.target.value);
                  onUserChange(e.target.value);
                }}
                aria-label="Switch local role"
              >
                {config.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.roleLabel}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </header>

      <main className="main">
        <Outlet />
      </main>

      <footer className="site-footer">
        <span>ClearDesk</span>
        <span className="muted">
          {session?.source === "gateway_demo" || session?.source === "gateway"
            ? "Signed in via gateway · local role switch"
            : session?.source === "agentic"
              ? "Session via API · local role switch"
              : apiBacked
                ? "Invoice automation"
                : "Invoice automation"}
        </span>
      </footer>

      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
