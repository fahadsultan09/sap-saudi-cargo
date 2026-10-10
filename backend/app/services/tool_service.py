from __future__ import annotations

import asyncio

from ..clients.sap import SAPClient
from ..enums import ToolName
from ..errors import ToolAccessDenied
from ..repository import Repository
from ..schemas import DuplicateCheck, ToolClaims, ToolPurchaseOrder, ToolResponse

AGENT_ACTOR = "agent"
SIMILAR_CASES_LIMIT = 5
# Each tool may only be called with the token's own values for these claims.
TOOL_SCOPE: dict[ToolName, tuple[str, ...]] = {
    ToolName.GET_PO: ("po",),
    ToolName.GET_GOODS_RECEIPTS: ("po",),
    ToolName.VENDOR_HISTORY: ("vendor",),
    ToolName.FIND_SIMILAR_CASES: ("vendor",),
    ToolName.GET_VENDOR: ("vendor",),
    ToolName.CHECK_DUPLICATE: ("vendor", "invoice_number"),
}


class ToolService:
    def __init__(self, repository: Repository, sap: SAPClient) -> None:
        self.repository = repository
        self.sap = sap

    async def run(
        self, name: ToolName, args: dict[str, str], claims: ToolClaims
    ) -> ToolResponse:
        scope = TOOL_SCOPE[name]
        if args != {field: getattr(claims, field) for field in scope}:
            raise ToolAccessDenied(
                f"{name} accepts only this case's {', '.join(scope)}"
            )
        result = await self._execute(name, claims)
        await asyncio.to_thread(
            self.repository.record_event,
            claims.case_id,
            AGENT_ACTOR,
            "tool_called",
            {"name": name.value, "args": args},
        )
        return ToolResponse(result=result)

    async def _execute(self, name: ToolName, claims: ToolClaims) -> object:
        match name:
            case ToolName.GET_PO:
                order = await self.sap.purchase_order(claims.po)
                if order is None:
                    return None
                return ToolPurchaseOrder(
                    po=order.number,
                    vendor=order.vendor,
                    amount=order.gross,
                    currency=order.currency,
                    gr_total=order.goods_receipt_gross,
                    change_log=await self.sap.po_changes(claims.po),
                ).model_dump(mode="json")
            case ToolName.GET_GOODS_RECEIPTS:
                receipts = await self.sap.goods_receipts(claims.po)
                return receipts.model_dump(mode="json")
            case ToolName.VENDOR_HISTORY:
                history = await self.sap.vendor_history(claims.vendor)
                return [entry.model_dump(mode="json") for entry in history]
            case ToolName.FIND_SIMILAR_CASES:
                cases = await asyncio.to_thread(
                    self.repository.similar_cases,
                    claims.case_id,
                    claims.vendor,
                    SIMILAR_CASES_LIMIT,
                )
                return [case.model_dump(mode="json") for case in cases]
            case ToolName.GET_VENDOR:
                vendor = await self.sap.vendor(claims.vendor)
                return vendor.model_dump(mode="json") if vendor is not None else None
            case ToolName.CHECK_DUPLICATE:
                in_open_case = await asyncio.to_thread(
                    self.repository.other_case_duplicate,
                    claims.case_id,
                    claims.vendor,
                    claims.invoice_number,
                )
                return DuplicateCheck(
                    in_sap=await self.sap.duplicate(claims.vendor, claims.invoice_number),
                    in_open_case=in_open_case,
                ).model_dump(mode="json")
