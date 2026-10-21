from triage.doc_ai import DocAIClient


def test_source_boxes_are_preserved_without_inventing_missing_coordinates():
    result = DocAIClient.convert_results({"extraction": {"headerFields": [
        {"name": "documentNumber", "value": "INV-1", "page": 2, "boundingBox": {"x": .1, "y": .2, "w": .3, "h": .04}},
        {"name": "senderName", "value": "Supplier"},
        {"name": "grossAmount", "value": 100, "page": 1, "boundingBox": {"x": 100, "y": 10, "w": 50, "h": 10}},
    ]}})
    assert result["invoice_source"]["invoice_number"] == "INV-1"
    assert result["field_locations"] == {"invoice_number": {"page": 2, "x": .1, "y": .2, "width": .3, "height": .04}}
