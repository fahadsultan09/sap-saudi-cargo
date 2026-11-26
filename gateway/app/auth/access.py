"""Route-level role checks, like SAP's xs-app.json route scopes, read from access-rules.json."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

ANY_ROLE = "*"


@dataclass(frozen=True)
class AccessRule:
    method: str
    pattern: re.Pattern[str]
    roles: frozenset[str]


def compile_path(path: str) -> re.Pattern[str]:
    """`{id}` matches one path segment and `**` the rest of the path."""
    regex = re.escape(path).replace(r"\*\*", ".*")
    regex = re.sub(r"\\\{[^/]+?\\\}", "[^/]+", regex)
    return re.compile(f"^{regex}$")


class AccessPolicy:
    def __init__(self, rules: list[AccessRule]) -> None:
        self.rules = rules

    @classmethod
    def load(cls, path: Path) -> AccessPolicy:
        routes = json.loads(path.read_text(encoding="utf-8"))["routes"]
        return cls([
            AccessRule(
                route["method"].upper(), compile_path(route["path"]), frozenset(route["roles"])
            )
            for route in routes
        ])

    def allows(self, method: str, path: str, roles: tuple[str, ...]) -> bool:
        """First matching rule decides; a call that no rule matches is refused."""
        for rule in self.rules:
            if rule.method == method.upper() and rule.pattern.match(path):
                return bool(roles) and (ANY_ROLE in rule.roles or not rule.roles.isdisjoint(roles))
        return False
