from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .errors import ConfigurationFailure


class RuleDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(min_length=1)
    description: str = Field(min_length=1)
    params: dict[str, object]


class RuleSet(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: str = Field(min_length=1)
    rules: list[RuleDefinition] = Field(min_length=1)


def load_rules(path: Path) -> RuleSet:
    try:
        return RuleSet.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValidationError) as exc:
        raise ConfigurationFailure("Rules file is missing or invalid") from exc
