from __future__ import annotations

import asyncio
from datetime import date
from decimal import Decimal
from typing import Protocol
from uuid import uuid4

from ..config import Settings
from ..errors import SAPUnavailable
from ..repository import Repository
from ..schemas import (
    DeliveryNote,
    GoodsReceiptDetail,
    GoodsReceiptPosting,
    PoChange,
    PostingPackage,
    PurchaseOrder,
    SapDocument,
    Vendor,
    VendorHistoryEntry,
)

MOCK_PO_CHANGES = {
    "4500012345": [
        PoChange(
            date=date(2026, 9, 30),
            note="Fuel surcharge of 900.00 SAR approved by procurement, "
            "PO amendment still pending",
        )
    ],
}
MOCK_DELIVERY_NOTES = {
    "4500012346": [
        DeliveryNote(
            date=date(2026, 10, 6),
            note="Delivered and signed at Dammam warehouse, GR not posted in S/4",
        )
    ],
}
MOCK_RECEIPT_DATES = {
    "4500012345": date(2026, 10, 2),
    "4500012346": date(2026, 10, 7),
    "4500012347": date(2026, 10, 1),
}
MOCK_VENDOR_HISTORY = {
    "V100": [
        VendorHistoryEntry(inv_no="INV-6100", variance="+0.0%", reason="none"),
        VendorHistoryEntry(
            inv_no="INV-6422",
            variance="+4.1%",
            reason="fuel surcharge later covered by PO amendment",
        ),
    ],
    "V200": [VendorHistoryEntry(inv_no="INV-8120", variance="+0.0%", reason="none")],
}


class SAPClient(Protocol):
    async def purchase_order(self, number: str) -> PurchaseOrder | None: ...

    async def vendor(self, vendor_id: str) -> Vendor | None: ...

    async def duplicate(self, vendor_id: str, invoice_number: str) -> bool: ...

    async def po_changes(self, number: str) -> list[PoChange]: ...

    async def goods_receipts(self, number: str) -> GoodsReceiptDetail: ...

    async def vendor_history(self, vendor_id: str) -> list[VendorHistoryEntry]: ...

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

    async def po_changes(self, number: str) -> list[PoChange]:
        self._check_mode()
        return MOCK_PO_CHANGES.get(number, [])

    async def goods_receipts(self, number: str) -> GoodsReceiptDetail:
        order = await self.purchase_order(number)
        posted = (
            [
                GoodsReceiptPosting(
                    date=MOCK_RECEIPT_DATES[number], amount=order.goods_receipt_gross
                )
            ]
            if order is not None and order.goods_receipt_gross is not None
            else []
        )
        notes = [] if posted else MOCK_DELIVERY_NOTES.get(number, [])
        return GoodsReceiptDetail(posted=posted, delivery_notes=notes)

    async def vendor_history(self, vendor_id: str) -> list[VendorHistoryEntry]:
        self._check_mode()
        return MOCK_VENDOR_HISTORY.get(vendor_id, [])

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
