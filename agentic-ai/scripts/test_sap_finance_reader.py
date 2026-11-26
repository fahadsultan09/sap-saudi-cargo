
from pprint import pprint

from src.integrations.excel_sap_finance_reader import ExcelSAPFinanceReader


def main():
    reader = ExcelSAPFinanceReader()

    print("\nLoaded row counts:")
    pprint(reader.dataset_counts())

    print("\nVendor bank lookup: supplier 46")
    pprint(reader.get_vendor_bank_details("46"))

    print("\nPO account assignments: PO 4200000010")
    pprint(reader.get_po_account_assignments("4200000010"))

    print("\nService entry sheets: PO 4500000070")
    pprint(reader.get_service_entry_sheets("4500000070"))


if __name__ == "__main__":
    main()
    