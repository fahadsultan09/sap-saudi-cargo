sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (Controller, MessageToast, MessageBox) {
    "use strict";

    return Controller.extend("saudicargo.ap.automation.controller.App", {
        onInit: function () { },

        onUploadChange: function (oEvent) {
            var oProgress = this.byId("uploadProgress");
            var oSection = this.byId("processingSection");

            oSection.setVisible(true);
            oProgress.setPercentValue(20);
            oProgress.setDisplayValue("Step 1/3: Document Received");

            setTimeout(function () {
                oProgress.setPercentValue(65);
                oProgress.setDisplayValue("Step 2/3: Sending to SAP Document AI...");
            }, 1500);

            setTimeout(function () {
                oProgress.setPercentValue(100);
                oProgress.setState("Success");
                oProgress.setDisplayValue("Step 3/3: Extraction & Business Rules Completed");
                MessageToast.show("Invoice uploaded and processed successfully!");
            }, 3500);
        },

        onApproveInvoice: function () {
            MessageBox.success("Invoice INV-2026-0912 approved and sent for posting to SAP S/4HANA.");
        },

        onRejectInvoice: function () {
            MessageBox.warning("Invoice INV-2026-0912 rejected and flagged for manual exception handling.");
        }
    });
});