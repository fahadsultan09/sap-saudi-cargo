"""Everything client-specific for one deployment, read from clients/<client>/client.json.

A new client = a new profile folder (client.json, logo, Keycloak realm) + their secrets; no code
changes.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class ProfileModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class Colors(ProfileModel):
    brand: str
    brand_dark: str
    brand_light: str
    brand_soft: str


class Branding(ProfileModel):
    app_title: str
    app_subtitle: str
    # Short letters shown in the header's brand mark, e.g. "AP".
    mark_text: str
    logo: str
    colors: Colors


class IdentityConfig(ProfileModel):
    provider: str = "oidc"
    issuer: str
    client_id: str
    scopes: list[str] = Field(default_factory=lambda: ["openid", "profile", "email"])
    # Dotted path to the provider's role list in the access token, e.g. "realm_access.roles".
    roles_claim: str
    # Provider role name -> app role; provider roles not listed are ignored.
    role_map: dict[str, str]


class AppRole(ProfileModel):
    id: str
    label: str


class ClientProfile(ProfileModel):
    name: str
    country_code: str
    branding: Branding
    identity: IdentityConfig
    # In priority order: a user with several roles acts with the first one listed.
    roles: list[AppRole]

    def primary_role(self, roles: tuple[str, ...]) -> str | None:
        return next((role.id for role in self.roles if role.id in roles), None)

    def public(self) -> dict[str, object]:
        """The part the frontend may see: no identity settings."""
        return {
            "name": self.name,
            "countryCode": self.country_code,
            "branding": {
                **self.branding.model_dump(by_alias=True),
                "logo": f"/client-assets/{self.branding.logo}",
            },
            "roles": [role.model_dump(by_alias=True) for role in self.roles],
        }


def load_profile(folder: Path) -> ClientProfile:
    return ClientProfile.model_validate_json((folder / "client.json").read_text(encoding="utf-8"))
