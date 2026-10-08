"""Short-lived signed token that lets the agent runtime read ONE case through the tool gateway. Only AP Core knows the secret."""
import os, hmac, hashlib, base64, json, time, uuid
class BadToken(Exception): pass
def _secret():
    s = os.getenv("TOOL_TOKEN_SECRET")
    if not s: raise BadToken("TOOL_TOKEN_SECRET not set")
    return s.encode()
def _b(x): return base64.urlsafe_b64encode(x).rstrip(b"=").decode()
def _sig(body): return _b(hmac.new(_secret(), body.encode(), hashlib.sha256).digest())
def issue(case_id, po, vendor, tools, ttl=None):
    claims = {"jti": uuid.uuid4().hex, "case": case_id, "po": po, "vendor": vendor, "tools": sorted(tools), "exp": int(time.time()) + int(ttl if ttl is not None else os.getenv("TOOL_TOKEN_TTL", "120"))}
    body = _b(json.dumps(claims, sort_keys=True).encode()); return f"{body}.{_sig(body)}", claims
def verify(tok):
    try: body, sig = tok.split(".")
    except ValueError: raise BadToken("malformed token")
    if not hmac.compare_digest(sig, _sig(body)): raise BadToken("bad signature")
    claims = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    if claims["exp"] < time.time(): raise BadToken("token expired")
    return claims
