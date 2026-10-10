from __future__ import annotations

from .. import tool_tokens
from ..clients.agent_runtime import AgentRuntime
from ..config import Settings
from ..errors import AgentFailure
from ..rules import RuleSet
from ..schemas import AgentCase, AgentFinding, AgentReport, AgentRequest, Case, Invoice


class AgentService:
    def __init__(self, runtime: AgentRuntime, settings: Settings, rules: RuleSet) -> None:
        self.runtime = runtime
        self.settings = settings
        self.rule_set = rules

    def _configured(self) -> bool:
        return all(
            (
                self.settings.agent_runtime_url,
                self.settings.runtime_api_key.get_secret_value(),
                self.settings.tool_token_secret.get_secret_value(),
            )
        )

    async def investigate(
        self, case: Case, invoice: Invoice
    ) -> tuple[AgentFinding, AgentReport]:
        if not self._configured():
            raise AgentFailure("Agent runtime is not configured")
        request = AgentRequest(
            case=AgentCase(
                case_id=case.id,
                vendor=invoice.vendor,
                inv_no=invoice.invoice_number,
                po=invoice.po_number,
                net=invoice.net,
                vat=invoice.vat,
                gross=invoice.net + invoice.vat,
                currency=invoice.currency,
                rules_version=self.rule_set.version,
                rules=[rule.model_dump(mode="json") for rule in self.rule_set.rules],
            ),
            token=tool_tokens.issue(self.settings, case.id, invoice),
        )
        report = await self.runtime.investigate(request)
        if report.final is None:
            raise AgentFailure(report.error or "Agent returned no final answer")
        return report.final, report
