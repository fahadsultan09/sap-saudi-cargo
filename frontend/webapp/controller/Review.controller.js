sap.ui.define([
    "saudicargo/ap/automation/controller/BaseController",
    "sap/m/MessageToast"
], function (BaseController, MessageToast) {
    "use strict";

    return BaseController.extend("saudicargo.ap.automation.controller.Review", {
        onInit: function () {
            this.getRouter().getRoute("review").attachPatternMatched(this._onRouteMatched, this);
        },

        // Without a case id the screen shows the case that is already open, or its empty state.
        _onRouteMatched: function (oEvent) {
            var sCaseId = oEvent.getParameter("arguments").caseId;
            if (sCaseId) {
                this.getCaseStore().loadCase(sCaseId);
            }
        },

        onNavBack: function () {
            this.navTo("dashboard");
        },

        onOpenDocument: function () {
            window.open(this.getData().getProperty("/selectedInvoice/documentUrl"), "_blank");
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
