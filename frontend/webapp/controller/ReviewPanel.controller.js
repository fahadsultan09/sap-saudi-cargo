sap.ui.define([
    "saudicargo/ap/automation/controller/BaseController",
    "sap/m/MessageToast"
], function (BaseController, MessageToast) {
    "use strict";

    // Shared Clear Desk panel: PDF + fields/tabs + decide bar (Home inline + #/review).
    return BaseController.extend("saudicargo.ap.automation.controller.ReviewPanel", {
        onInit: function () {
            this.getOwnerComponent().getModel("apData").bindProperty("/selectedInvoice/documentUrl")
                .attachChange(this._syncPdfFrame, this);
        },

        onAfterRendering: function () {
            this._syncPdfFrame();
        },

        onOpenDocument: function () {
            var sUrl = this.getData().getProperty("/selectedInvoice/documentUrl");
            if (sUrl) {
                window.open(sUrl, "_blank");
            }
        },

        // "Check comparison" on the SAP data check's row: open the Fields tab and briefly highlight the table.
        onOpenComparison: function () {
            var oCard = this.byId("fieldsCard");
            this.getData().setProperty("/reviewTabKey", "details");
            if (!oCard) {
                return;
            }
            oCard.removeStyleClass("apHighlight");
            setTimeout(function () {
                oCard.addStyleClass("apHighlight");
            }, 0);
        },

        onSelectAgent: function (oEvent) {
            this.getCaseStore().selectAgent(oEvent.getParameter("listItem").getBindingContext("apData").getProperty("key"));
        },

        onReviewTabSelect: function (oEvent) {
            var oContent = oEvent.getSource().$().find(".sapMITBContent").get(0);
            if (!oContent) {
                return;
            }
            oContent.classList.remove("apTabFadeReplay");
            void oContent.offsetWidth;
            oContent.classList.add("apTabFadeReplay");
        },

        onEditFields: function () {
            this.getData().setProperty("/selectedInvoice/editing", true);
        },

        onCancelEdit: function () {
            var oData = this.getData();
            oData.setProperty("/selectedInvoice/fields", oData.getProperty("/selectedInvoice/fields").map(function (oField) {
                return Object.assign({}, oField, { value: oField.editable ? oField.original : oField.value });
            }));
            oData.setProperty("/selectedInvoice/editing", false);
        },

        onSaveCorrections: function () {
            var that = this;
            var oChanges = {};
            this.getData().getProperty("/selectedInvoice/fields").forEach(function (oField) {
                var sValue = String(oField.value || "").trim();
                if (oField.editable && sValue !== oField.original) {
                    oChanges[oField.key] = sValue;
                }
            });
            if (!Object.keys(oChanges).length) {
                MessageToast.show("No changes to save");
                return;
            }
            this._openDecisionDialog({
                title: "Save corrections",
                label: "What did you correct and why?",
                placeholder: "e.g. Total and date checked against the PDF",
                submitText: "Save"
            }).then(function (oResult) {
                if (!oResult) {
                    return null;
                }
                var sCaseId = that.getData().getProperty("/selectedInvoice/caseId");
                return that._caseRequest("PATCH", sCaseId, "fields", { fields: oChanges, comment: oResult.text },
                    "Corrections saved");
            }).catch(function () { });
        },

        // Native xhtml:iframe may not bind blob URLs reliably; write src on the live DOM node.
        _syncPdfFrame: function () {
            var oView = this.getView();
            var sUrl = this.getData().getProperty("/selectedInvoice/documentIsImage")
                ? "" : this.getData().getProperty("/selectedInvoice/documentUrl") || "";
            var oFrame = oView.byId("invoicePdfFrame");
            if (!oFrame) {
                return;
            }
            var fnApply = function () {
                var oDom = oFrame.getDomRef ? oFrame.getDomRef() : null;
                if (!oDom || oDom.tagName !== "IFRAME") {
                    oDom = document.getElementById(oView.createId("invoicePdfFrame"));
                }
                if (!oDom || oDom.tagName !== "IFRAME") {
                    return false;
                }
                if ((oDom.getAttribute("src") || "") !== sUrl) {
                    oDom.setAttribute("src", sUrl);
                }
                oDom.style.display = sUrl ? "block" : "none";
                return true;
            };
            if (!fnApply()) {
                oView.attachEventOnce("afterRendering", fnApply);
            }
        }
    });
});
