sap.ui.define([
    "saudicargo/ap/automation/controller/BaseController",
    "sap/m/MessageToast",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/Image",
    "sap/ui/core/HTML",
    "sap/ui/Device",
    "sap/base/security/encodeXML"
], function (BaseController, MessageToast, Dialog, Button, Image, HTML, Device, encodeXML) {
    "use strict";

    return BaseController.extend("saudicargo.ap.automation.controller.Review", {
        onInit: function () {
            this.getRouter().getRoute("review").attachPatternMatched(this._onRouteMatched, this);
        },

        // Without a case id the screen shows the case that is already open, or its empty state.
        _onRouteMatched: function (oEvent) {
            var that = this;
            var sCaseId = oEvent.getParameter("arguments").caseId;
            if (sCaseId) {
                this.getCaseStore().loadCase(sCaseId).then(function () {
                    // While the agents work, open the live processing steps.
                    if (that.getData().getProperty("/selectedInvoice/isProcessing")) {
                        that.getData().setProperty("/reviewTabKey", "steps");
                    }
                });
            }
        },

        // The invoice opens on demand in a large window, so the review itself uses the full width.
        onViewInvoice: function () {
            var oInvoice = this.getData().getProperty("/selectedInvoice");
            var sUrl = encodeXML(oInvoice.documentUrl);
            var oPreview = oInvoice.documentIsImage
                ? new Image({ src: oInvoice.documentUrl, alt: "Invoice document", densityAware: false })
                : new HTML({ content: '<iframe class="apDocFrame" title="Invoice document" src="' + sUrl + '"></iframe>' });
            var oDialog = new Dialog({
                title: "Invoice " + oInvoice.id,
                contentWidth: "90vw",
                contentHeight: "85vh",
                stretch: Device.system.phone,
                resizable: true,
                draggable: true,
                content: [oPreview],
                beginButton: new Button({
                    text: "Open in new tab",
                    icon: "sap-icon://inspect-open",
                    press: this.onOpenDocument.bind(this)
                }),
                endButton: new Button({
                    text: "Close",
                    press: function () {
                        oDialog.close();
                    }
                }),
                afterClose: function () {
                    oDialog.destroy();
                }
            }).addStyleClass("apDocDialog");
            this.getView().addDependent(oDialog);
            oDialog.open();
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
            oCard.removeStyleClass("apHighlight");
            setTimeout(function () {
                oCard.addStyleClass("apHighlight");
            }, 0);
        },

        // A step on the agent stepper: show that agent's details below it.
        onSelectAgent: function (oEvent) {
            this.getCaseStore().selectAgent(oEvent.getParameter("listItem").getBindingContext("apData").getProperty("key"));
        },

        // Replays the soft tab fade when switching tabs.
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

        onEditFields: function () {
            this.getData().setProperty("/selectedInvoice/editing", true);
        },

        // Cancel puts back the values from before Edit.
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
        }
    });
});
