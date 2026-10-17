sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/Fragment",
    "sap/ui/core/BusyIndicator",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "saudicargo/ap/automation/model/constants"
], function (Controller, Fragment, BusyIndicator, JSONModel, MessageToast, MessageBox, C) {
    "use strict";

    // Helpers shared by the screen controllers: models, navigation, case actions and the comment dialog.
    return Controller.extend("saudicargo.ap.automation.controller.BaseController", {
        getData: function () {
            return this.getOwnerComponent().getModel("apData");
        },

        getConfig: function () {
            return this.getOwnerComponent().getModel("config");
        },

        getCaseStore: function () {
            return this.getOwnerComponent().getCaseStore();
        },

        getRouter: function () {
            return this.getOwnerComponent().getRouter();
        },

        navTo: function (sRoute, oParameters) {
            this.getRouter().navTo(sRoute, oParameters);
        },

        onCasePress: function (oEvent) {
            this.navTo("review", { caseId: oEvent.getSource().getBindingContext("apData").getObject().caseId });
        },

        // ------------------------------------------------------- case actions

        // Approving is the lightest action — a comment helps the audit trail but is not required.
        // Returning or rejecting always needs a reason, since it sends the case backwards.
        onApproveInvoice: function (oEvent) {
            this._decide(oEvent, "approve", "Approve invoice", "Approve", "Invoice approved", {
                label: "Comment (optional)", placeholder: "Add a note for the audit trail", minLength: 0
            });
        },

        onReturnInvoice: function (oEvent) {
            this._decide(oEvent, "return", "Return to processor", "Return", "Case returned to processor", {
                label: "Comment", placeholder: "Reason for this decision", minLength: 3
            });
        },

        onRejectInvoice: function (oEvent) {
            this._decide(oEvent, "reject", "Reject invoice", "Reject", "Invoice rejected", {
                label: "Comment", placeholder: "Reason for this decision", minLength: 3
            });
        },

        // Decisions work from the review screen and from approval-queue rows.
        _decide: function (oEvent, sAction, sTitle, sSubmitText, sSuccessText, oDialogOptions) {
            var that = this;
            var oRowContext = oEvent.getSource().getBindingContext("apData");
            var oRow = oRowContext && oRowContext.getObject();
            var sCaseId = oRow && oRow.caseId ? oRow.caseId : this.getData().getProperty("/selectedInvoice/caseId");
            this._openDecisionDialog(Object.assign({
                title: sTitle,
                label: "Comment",
                placeholder: "Reason for this decision",
                submitText: sSubmitText,
                minLength: 3
            }, oDialogOptions)).then(function (oResult) {
                return oResult && that._caseRequest("POST", sCaseId, sAction, { comment: oResult.text }, sSuccessText);
            }).catch(function () { });
        },

        _caseRequest: function (sMethod, sCaseId, sAction, oBody, sSuccessText) {
            var oStore = this.getCaseStore();
            BusyIndicator.show(0);
            return oStore.call(sMethod, oStore.casePath(sCaseId) + "/" + sAction, oBody)
                .then(function (oResult) {
                    MessageToast.show(sSuccessText + " — status: " + (C.STATUS_LABELS[oResult.status] || oResult.status));
                    oStore.reloadAfterChange(sCaseId);
                }).catch(function (oError) {
                    MessageBox.error(oError.message);
                    throw oError;
                }).finally(function () {
                    BusyIndicator.hide();
                });
        },

        // ------------------------------------------------------- comment dialog

        _openDecisionDialog: function (oOptions) {
            var that = this;
            var oView = this.getView();
            if (!oView.getModel("dialog")) {
                oView.setModel(new JSONModel({}), "dialog");
            }
            oView.getModel("dialog").setData(Object.assign({
                title: "", label: "", placeholder: "", submitText: "OK", text: "", minLength: 3
            }, oOptions));
            if (!this._decisionDialog) {
                this._decisionDialog = Fragment.load({
                    id: oView.getId(),
                    name: "saudicargo.ap.automation.view.fragments.DecisionDialog",
                    controller: this
                }).then(function (oDialog) {
                    oView.addDependent(oDialog);
                    return oDialog;
                });
            }
            return this._decisionDialog.then(function (oDialog) {
                oDialog.open();
                return new Promise(function (resolve) {
                    that._resolveDecision = resolve;
                });
            });
        },

        onDecisionDialogSubmit: function () {
            this._closeDecisionDialog({ text: this.getView().getModel("dialog").getProperty("/text").trim() });
        },

        onDecisionDialogCancel: function () {
            this._closeDecisionDialog(null);
        },

        _closeDecisionDialog: function (oResult) {
            this.byId("decisionDialog").close();
            this._resolveDecision(oResult);
        }
    });
});
