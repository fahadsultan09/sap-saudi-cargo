sap.ui.define([
    "saudicargo/ap/automation/controller/BaseController",
    "sap/m/MessageToast"
], function (BaseController, MessageToast) {
    "use strict";

    return BaseController.extend("saudicargo.ap.automation.controller.Review", {
        onInit: function () {
            this.getRouter().getRoute("review").attachPatternMatched(this._onRouteMatched, this);
            this.getOwnerComponent().getModel("apData").bindProperty("/selectedInvoice/documentUrl")
                .attachChange(this._syncPdfFrame, this);
        },

        // Without a case id the screen shows the case that is already open, or its empty state.
        _onRouteMatched: function (oEvent) {
            var sCaseId = oEvent.getParameter("arguments").caseId;
            if (sCaseId) {
                this.getCaseStore().loadCase(sCaseId);
            }
            this._syncPdfFrame();
        },

        onNavBack: function () {
            this.navTo("dashboard");
        },

        onOpenDocument: function () {
            var sUrl = this.getData().getProperty("/selectedInvoice/documentUrl");
            if (sUrl) {
                window.open(sUrl, "_blank");
            }
        },

        // Replays the soft tab fade when switching Agent Results / Invoice Fields.
        onReviewTabSelect: function (oEvent) {
            var oContent = oEvent.getSource().$().find(".sapMITBContent").get(0);
            if (!oContent) {
                return;
            }
            oContent.classList.remove("apTabFadeReplay");
            // Force reflow so the animation can restart.
            void oContent.offsetWidth;
            oContent.classList.add("apTabFadeReplay");
        },

        // Native xhtml:iframe may not exist until afterRendering; blob URL needs a live src write.
        _syncPdfFrame: function () {
            var oView = this.getView();
            var sUrl = this.getData().getProperty("/selectedInvoice/documentUrl") || "";
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
        },

        onSaveCorrections: function () {
            var that = this;
            var oChanges = {};
            this.getData().getProperty("/selectedInvoice/fields").forEach(function (oField) {
                var sValue = String(oField.value || "").trim();
                if (sValue !== oField.original) {
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
        }
    });
});
