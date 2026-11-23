"""Callback history recovery must never exchange a one-use authorization code twice."""
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import dependencies, routes
from app.auth.provider import LoginRequest, Principal, TokenSet
from app.auth.sessions import MemorySessionStore
from app.core.errors import NotSignedIn


class Provider:
    def __init__(self):
        self.exchanges = 0
        self.reject = False

    async def exchange_code(self, code, request, redirect_uri):
        self.exchanges += 1
        if self.reject:
            raise NotSignedIn("Invalid code")
        return TokenSet("test-access", time.time() + 3600)

    async def principal(self, tokens):
        return Principal("processor", "Processor", None, ("AP_PROCESSOR",))


class CallbackHistoryTests(unittest.TestCase):
    def setUp(self):
        settings = SimpleNamespace(public_url="http://testserver", session_cookie="ap_session", session_cookie_secure=False)
        self.addCleanup(patch.stopall)
        patch.object(routes, "get_settings", return_value=settings).start()
        patch.object(dependencies, "get_settings", return_value=settings).start()
        self.sessions = MemorySessionStore()
        self.provider = Provider()
        app = FastAPI()
        app.state.sessions = self.sessions
        app.state.identity = self.provider
        app.include_router(routes.router)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def login_request(self, target="#/review/case-1"):
        request = LoginRequest("test-state", "nonce", "verifier", target)
        self.sessions.save_login(request)
        return request

    def test_success_replaces_callback_and_preserves_deep_link_and_cookie(self):
        self.login_request()
        response = self.client.get("/auth/callback?state=test-state&code=single-use")
        self.assertEqual(response.status_code, 200)
        self.assertIn('window.location.replace("/#/review/case-1")', response.text)
        self.assertIn("HttpOnly", response.headers["set-cookie"])
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.headers["referrer-policy"], "no-referrer")
        self.assertEqual(self.provider.exchanges, 1)

    def test_back_to_consumed_callback_recovers_existing_session_without_exchange(self):
        self.login_request()
        url = "/auth/callback?state=test-state&code=single-use"
        self.client.get(url)
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertIn('window.location.replace("/#/dashboard")', response.text)
        self.assertNotIn("could not be completed", response.text)
        self.assertEqual(self.provider.exchanges, 1)

    def test_stale_callback_after_restart_starts_fresh_login(self):
        self.client.cookies.set("ap_session", "session-lost-after-restart")
        response = self.client.get("/auth/callback?state=old&code=old-code", follow_redirects=False)
        self.assertEqual(response.status_code, 303)
        self.assertEqual(response.headers["location"], "/auth/login")
        self.assertEqual(self.provider.exchanges, 0)

    def test_expired_session_is_not_trusted_on_callback_replay(self):
        session = self.sessions.create(TokenSet("expired", time.time() - 60), Principal("user", "User", None, ("AP_PROCESSOR",)))
        self.client.cookies.set("ap_session", session.id)
        response = self.client.get("/auth/callback?state=old&code=old-code", follow_redirects=False)
        self.assertEqual(response.status_code, 303)
        self.assertIsNone(self.sessions.get(session.id))
        self.assertEqual(self.provider.exchanges, 0)

    def test_real_exchange_failure_still_fails_and_creates_no_session(self):
        self.login_request()
        self.provider.reject = True
        response = self.client.get("/auth/callback?state=test-state&code=bad-code")
        self.assertEqual(response.status_code, 400)
        self.assertNotIn("ap_session", self.client.cookies)

    def test_callback_page_escapes_script_and_link_content(self):
        response = routes.finish_sign_in('/#/review/</script><script>alert("x")</script>')
        body = response.body.decode()
        self.assertNotIn('<script>alert', body)
        self.assertIn("\\u003c", body)


if __name__ == "__main__":
    unittest.main()
