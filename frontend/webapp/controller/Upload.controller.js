sap.ui.define([
    "saudicargo/ap/automation/controller/BaseController",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (BaseController, MessageToast, MessageBox) {
    "use strict";

    return BaseController.extend("saudicargo.ap.automation.controller.Upload", {
        onUploadChange: function (oEvent) {
            var oFile = (oEvent.getParameter("files") || [])[0];
            if (!oFile) {
                MessageToast.show("No file selected");
                return;
            }
            this._uploadInvoiceFile(oFile);
        },

        // The agents run in the background after the upload, so the user goes straight back to the
        // dashboard, where the case shows as processing and updates by itself when they finish.
        _uploadInvoiceFile: function (oFile) {
            var that = this;
            var oData = this.getData();
            var oFormData = new FormData();
            oFormData.append("file", oFile, oFile.name);

            oData.setProperty("/upload", { visible: true, message: "Uploading " + oFile.name + "…", state: "Information" });
            oData.setProperty("/busy", true);

            this.getCaseStore().call("POST", "/api/v1/cases/upload", oFormData).then(function () {
                oData.setProperty("/upload/visible", false);
                MessageToast.show(oFile.name + " received. The agents are processing it.");
                that.navTo("dashboard");
            }).catch(function (oError) {
                oData.setProperty("/upload", { visible: true, message: "Upload failed", state: "Error" });
                MessageBox.error(oError.message);
            }).finally(function () {
                oData.setProperty("/busy", false);
                that.byId("fileUploader").clear();
            });
        }
    });
});
