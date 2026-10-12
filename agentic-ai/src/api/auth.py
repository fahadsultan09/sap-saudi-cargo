from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import AUTH_MODE, JWT_AUDIENCE, JWT_ISSUER
from .schemas import Actor

_bearer = HTTPBearer(auto_error=False)
VALID_ROLES = {"AP_PROCESSOR", "AP_APPROVER", "FINANCE_MANAGER", "ADMIN"}


def get_actor(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> Actor:
    """Resolve actor from development headers or a verified HS256 JWT.

    Development headers are deliberately unavailable outside APP_ENV=development.
    Production must use AUTH_MODE=jwt and a trusted issuer/secret.
    """
    if AUTH_MODE == "dev":
        user_id = request.headers.get("x-user-id", "").strip()
        role = request.headers.get("x-user-role", "").strip().upper()
        if not user_id or role not in VALID_ROLES:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Development auth requires X-User-Id and X-User-Role headers",
            )
        return Actor(user_id=user_id, role=role, email=request.headers.get("x-user-email"))

    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Bearer token required")
    try:
        import jwt
        from .config import JWT_SECRET
        options = {"require": ["sub", "exp"]}
        kwargs = {"algorithms": ["HS256"], "options": options}
        if JWT_ISSUER:
            kwargs["issuer"] = JWT_ISSUER
        if JWT_AUDIENCE:
            kwargs["audience"] = JWT_AUDIENCE
        payload = jwt.decode(credentials.credentials, JWT_SECRET, **kwargs)
        user_id = str(payload.get("sub", "")).strip()
        role = str(payload.get("role", "")).upper()
        if not user_id or role not in VALID_ROLES:
            raise ValueError("Missing or invalid subject/role claims")
        return Actor(user_id=user_id, role=role, email=payload.get("email"))
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired access token") from exc


def require_roles(*roles: str):
    def dependency(actor: Actor = Depends(get_actor)) -> Actor:
        if actor.role not in roles:
            raise HTTPException(status_code=403, detail="Insufficient role permissions")
        return actor
    return dependency
