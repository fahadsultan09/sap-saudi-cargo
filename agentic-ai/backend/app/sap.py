"""SAP adapter. Read path and write path are separate on purpose. Mock data here; real one calls OData on S/4 through Cloud Connector."""
from decimal import Decimal as D

VENDORS = {
    "V100": {"name": "Gulf Aviation Fuel Co", "active": True},
    "V200": {"name": "Dammam Ground Equip.", "active": True},
    "V300": {"name": "Red Sea Handling", "active": False},
}
POS = {
    "4500012345": {"vendor": "V100", "amount": D("11500"), "gr": D("11500")},
    "4500012346": {"vendor": "V200", "amount": D("8000"), "gr": None},
    "4500012347": {"vendor": "V100", "amount": D("4600"), "gr": D("4600")},
}


def read_po(po):
    return POS.get(po)


def read_vendor(v):
    return VENDORS.get(v)


def read_doc(c, doc):
    return c.execute("SELECT * FROM sap_doc WHERE doc=?", (doc,)).fetchone()


def find_vendor(name):
    n = (name or "").strip().lower()
    return next((k for k, v in VENDORS.items() if v["name"].lower() == n), None)


# Extra mock data the investigating agent can read (read-only tools only).
PO_CHANGES = {
    "4500012345": [
        {
            "date": "2026-09-30",
            "note": "Fuel surcharge of 900.00 SAR approved by procurement, PO amendment still pending",
        }
    ]
}
GOODS_RECEIPTS = {
    "4500012345": [{"date": "2026-10-02", "amount": "11500.00"}],
    "4500012347": [{"date": "2026-10-01", "amount": "4600.00"}],
    "4500012346": [],
}
DELIVERY_NOTES = {
    "4500012346": [
        {
            "date": "2026-10-06",
            "note": "Delivered and signed at Dammam warehouse, GR not posted in S/4",
        }
    ]
}
VENDOR_HISTORY = {
    "V100": [
        {"inv_no": "INV-6100", "variance": "+0.0%", "reason": "none"},
        {
            "inv_no": "INV-6422",
            "variance": "+4.1%",
            "reason": "fuel surcharge later covered by PO amendment",
        },
    ],
    "V200": [{"inv_no": "INV-8120", "variance": "+0.0%", "reason": "none"}],
}
