sap.ui.define([
    "saudicargo/ap/automation/controller/BaseController",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (BaseController, MessageToast, MessageBox) {
    "use strict";

    // Only "Receive invoice" is tracked live on this screen — that is the one step that actually
    // happens here. Classification, extraction and the finance checks run after the file lands and
    // show up as the case processes on the Dashboard and Review screens, so they stay "upcoming"
    // here rather than faking progress we cannot see yet.
    var UPLOAD_STEPS = [
        { key: "receive", title: "Receive invoice", description: "Your file lands in the queue and gets a case.", icon: "sap-icon://upload-to-cloud" },
        { key: "classify", title: "Classify · TOWER", description: "Confirms it is an invoice or credit note.", icon: "sap-icon://inspect" },
        { key: "extract", title: "Extract · LENS", description: "Reads supplier, amounts, PO and dates.", icon: "sap-icon://create-form" },
        { key: "validate", title: "Finance checks", description: "Vendor, PO, tax and duplicate rules run.", icon: "sap-icon://lab" }
    ];

    return BaseController.extend("saudicargo.ap.automation.controller.Upload", {
        onInit: function () {
            this._resetSteps();
            this.getRouter().getRoute("upload").attachPatternMatched(this._resetSteps, this);
        },

        onAfterRendering: function () {
            this._attachDropZone();
        },

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

            this._resetSteps();
            oData.setProperty("/upload", {
                visible: true, message: "Receiving " + oFile.name + "…", state: "Information", fileName: oFile.name
            });
            oData.setProperty("/busy", true);
            that._setDropZoneBusy(true);
            that._setStepState("receive", "active");

            this.getCaseStore().call("POST", "/api/v1/cases/upload", oFormData).then(function () {
                oData.setProperty("/upload/visible", false);
                that._setStepState("receive", "done");
                MessageToast.show(oFile.name + " is in the queue — TOWER and LENS are on it.");
                that.navTo("dashboard");
            }).catch(function (oError) {
                oData.setProperty("/upload", {
                    visible: true, message: "Upload failed", state: "Error", fileName: oFile.name
                });
                that._setStepState("receive", "error");
                MessageBox.error(oError.message);
            }).finally(function () {
                oData.setProperty("/busy", false);
                that._setDropZoneBusy(false);
                var oUploader = that.byId("fileUploader");
                if (oUploader) {
                    oUploader.clear();
                }
            });
        },

        _resetSteps: function () {
            this.getData().setProperty("/uploadSteps", UPLOAD_STEPS.map(function (oStep) {
                return Object.assign({ state: "upcoming" }, oStep);
            }));
        },

        _setStepState: function (sKey, sState) {
            var oData = this.getData();
            var aSteps = (oData.getProperty("/uploadSteps") || []).map(function (oStep) {
                return oStep.key === sKey ? Object.assign({}, oStep, { state: sState }) : oStep;
            });
            oData.setProperty("/uploadSteps", aSteps);
        },

        _setDropZoneBusy: function (bBusy) {
            var oZone = this.byId("dropZone");
            if (!oZone) {
                return;
            }
            oZone.toggleStyleClass("apHeroDrop--busy", !!bBusy);
        },

        // Native HTML5 drag-and-drop onto the hero zone, feeding the same upload path as the
        // "Browse files" button so the API call, busy state and step tracking stay identical.
        _attachDropZone: function () {
            if (this._dropZoneAttached) {
                return;
            }
            var oZone = this.byId("dropZone");
            var oDom = oZone && oZone.getDomRef();
            if (!oDom) {
                return;
            }
            this._dropZoneAttached = true;
            var that = this;

            var fnOver = function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (!that.getData().getProperty("/busy")) {
                    oZone.addStyleClass("apHeroDrop--dragover");
                }
            };
            var fnOut = function (e) {
                e.preventDefault();
                e.stopPropagation();
                oZone.removeStyleClass("apHeroDrop--dragover");
            };
            var fnDrop = function (e) {
                fnOut(e);
                var aFiles = (e.dataTransfer && e.dataTransfer.files) || [];
                if (aFiles.length && !that.getData().getProperty("/busy")) {
                    that._uploadInvoiceFile(aFiles[0]);
                }
            };

            ["dragenter", "dragover"].forEach(function (sType) {
                oDom.addEventListener(sType, fnOver);
            });
            oDom.addEventListener("dragleave", fnOut);
            oDom.addEventListener("drop", fnDrop);
        }
    });
});
