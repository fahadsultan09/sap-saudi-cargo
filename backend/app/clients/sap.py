from __future__ import annotations

import asyncio
from decimal import Decimal
from typing import Protocol
from uuid import uuid4

from ..config import Settings
from ..errors import SAPUnavailable
from ..repository import Repository
from ..schemas import PostingPackage, PurchaseOrder, SapDocument, Vendor


class SAPClient(Protocol):
    async def purchase_order(self, number: str) -> PurchaseOrder | None: ...

    async def vendor(self, vendor_id: str) -> Vendor | None: ...

    async def duplicate(self, vendor_id: str, invoice_number: str) -> bool: ...

    async def post(
        self, package: PostingPackage, idempotency_key: str
    ) -> SapDocument: ...

    async def document(self, document_id: str) -> SapDocument: ...

    async def find_posting(self, idempotency_key: str) -> SapDocument | None: ...


class MockSAPClient:
    def __init__(self, repository: Repository, settings: Settings) -> None:
        self.repository = repository
        self.settings = settings

    def _check_mode(self) -> None:
        if self.settings.sap_mode != "mock":
            raise SAPUnavailable("Real S/4HANA adapter is not implemented")

    async def purchase_order(self, number: str) -> PurchaseOrder | None:
        self._check_mode()
        orders = {
            "4500012345": ("V100", "11500.00", "11500.00"),
            "4500012346": (
                "V200",
                "8000.00",
                "8000.00" if self.settings.mock_missing_gr_posted else None,
            ),
            "4500012347": ("V100", "4600.00", "4600.00"),
        }
        data = orders.get(number)
        if data is None:
            return None
        vendor, gross, receipt = data
        return PurchaseOrder(
            number=number,
            vendor=vendor,
            gross=Decimal(gross),
            currency="SAR",
            goods_receipt_gross=Decimal(receipt) if receipt is not None else None,
        )

    async def vendor(self, vendor_id: str) -> Vendor | None:
        self._check_mode()
        active = {"V100": True, "V200": True, "V300": False}.get(vendor_id)
        return Vendor(id=vendor_id, active=active) if active is not None else None

    async def duplicate(self, vendor_id: str, invoice_number: str) -> bool:
        self._check_mode()
        return await asyncio.to_thread(
            self.repository.mock_duplicate, vendor_id, invoice_number
        )

    async def post(self, package: PostingPackage, idempotency_key: str) -> SapDocument:
        self._check_mode()
        document_id = f"MOCK-{uuid4().hex}"
        return await asyncio.to_thread(
            self.repository.mock_post, document_id, package, idempotency_key
        )

    async def document(self, document_id: str) -> SapDocument:
        self._check_mode()
        return await asyncio.to_thread(self.repository.mock_read, document_id)

    async def find_posting(self, idempotency_key: str) -> SapDocument | None:
        self._check_mode()
        return await asyncio.to_thread(
            self.repository.mock_find_posting, idempotency_key
        )
