sap.ui.define([
    "saudicargo/ap/automation/controller/BaseController",
    "sap/m/MessageToast",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/Image",
    "sap/ui/core/HTML",
    "sap/ui/Device",
    "sap/base/security/encodeXML",
    "sap/ui/core/Fragment",
    "sap/ui/model/json/JSONModel",
    "saudicargo/ap/automation/model/financeRuleMessages",
    "saudicargo/ap/automation/model/agentInformation"
], function (BaseController, MessageToast, Dialog, Button, Image, HTML, Device, encodeXML, Fragment, JSONModel, FinanceRuleMessages, AgentInformation) {
    "use strict";

    // The page's sections, top to bottom; each tab key matches a section-<key> id in the view.
    var SECTIONS = ["overview", "agents", "issues", "info", "details", "lineItems", "audit"];

    // Shared review panel (Home under the pipeline, and #/review): master data, tabs and the decide bar.
    return BaseController.extend("saudicargo.ap.automation.controller.ReviewPanel", {
        onInit: function () {
            // Home's pipeline asks the panel under it to show a step's outcome.
            this.getOwnerComponent().getEventBus().subscribe("review", "goTo", this._onGoTo, this);
            this._documentBinding = this.getData().bindProperty("/selectedInvoice/documentUrl");
            this._documentBinding.attachChange(this._syncProcessorPdf, this);
            this._pdfReady = function (event) {
                var node = this.byId("processorPdf").getDomRef();
                var frame = node && node.querySelector("iframe");
                if (event.origin === window.location.origin && frame && event.source === frame.contentWindow
                    && event.data && event.data.type === "ap-pdf-ready" && this._pendingFocus) {
                    frame.contentWindow.postMessage(this._pendingFocus, window.location.origin);
                }
            }.bind(this);
            window.addEventListener("message", this._pdfReady);
        },

        onAfterRendering: function () {
            this._syncProcessorPdf();
            if (!this._fnSyncTab) {
                this._fnSyncTab = this._syncTabToScroll.bind(this);
                // Scroll events do not bubble, so they are caught on the way down from whichever container
                // scrolls: the panel itself on #/review, the page on Home.
                document.addEventListener("scroll", this._fnSyncTab, true);
            }
        },

        onExit: function () {
            this.getOwnerComponent().getEventBus().unsubscribe("review", "goTo", this._onGoTo, this);
            document.removeEventListener("scroll", this._fnSyncTab, true);
            clearTimeout(this._scrollLock);
            this._documentBinding.destroy();
            window.removeEventListener("message", this._pdfReady);
        },

        // A step on the flow: go to its outcome, e.g. Classify → CLASSIFIER's result, Fetch PO → the PO in Info.
        onFlowStep: function (oEvent) {
            var sStep = oEvent.getSource().getBindingContext("apData").getProperty("key");
            this._scrollTo(sStep === "processorReview" ? "details" : this.getCaseStore().stepTarget(sStep));
        },

        _onGoTo: function (sChannel, sEvent, oData) {
            // Both the Home panel and the #/review panel listen; only the one on screen moves.
            if (this.byId("reviewTabs").getDomRef() && this.byId("reviewTabs").getDomRef().offsetParent) {
                this._scrollTo(oData.target);
            }
        },

        onFieldsFilter: function (oEvent) {
            this.getData().setProperty("/selectedInvoice/fieldsDiffOnly", oEvent.getParameter("item").getKey() === "diff");
        },

        onAgentInfo: function () {
            var agent = this.getData().getProperty("/selectedInvoice/agentDetail");
            if (!agent) return;
            if (agent.key === "FINANCE_RULES") {
                this.onFinanceRulesInfo();
                return;
            }
            var that = this;
            this.getView().setModel(new JSONModel(AgentInformation.describe(agent)), "agentInfo");
            if (!this._agentInfoDialog) {
                this._agentInfoDialog = Fragment.load({id: this.getView().getId(),
                    name: "saudicargo.ap.automation.view.fragments.AgentInfoDialog", controller: this})
                    .then(function (dialog) { that.getView().addDependent(dialog); return dialog; });
            }
            this._agentInfoDialog.then(function (dialog) { dialog.open(); });
        },

        onCloseAgentInfo: function () {
            this.byId("agentInfoDialog").close();
        },

        onFinanceRulesInfo: function () {
            var that = this;
            var invoice = this.getData().getProperty("/selectedInvoice");
            var rows = (invoice.financeRules || []).map(function (rule) {
                return that._financeRuleRow(rule, "Finance Rules stage");
            });
            var model = new JSONModel({invoice: invoice.id, rows: rows, busy: true, error: "",
                notice: rows.length ? "Thresholds and results were recorded when this invoice was processed."
                    : "This invoice has no saved Finance Rules detail. Re-run extraction to record the tested rules and thresholds. No historical results have been inferred."});
            this.getView().setModel(model, "financeRules");
            if (!this._financeDialog) {
                this._financeDialog = Fragment.load({id: this.getView().getId(),
                    name: "saudicargo.ap.automation.view.fragments.FinanceRulesDialog", controller: this})
                    .then(function (dialog) { that.getView().addDependent(dialog); return dialog; });
            }
            this._financeDialog.then(function (dialog) { dialog.open(); });
            this.getCaseStore().call("GET", this.getCaseStore().casePath(invoice.caseId) + "/rule-results")
                .then(function (result) {
                    var core = (result.items || []).map(function (rule) {
                        var evidence = rule.evidence || {};
                        return that._financeRuleRow({rule_id: rule.rule_code, description: rule.reason,
                            parameter: rule.rule_code === "REQUIRED_FIELDS_PRESENT" ? "All required AP Core fields must be present"
                                : rule.rule_code === "BUSINESS_DUPLICATE" ? "Supplier + invoice number + company code must not match another non-rejected case" : "See recorded evidence",
                            evidence: evidence, outcome: rule.outcome}, "AP Core · " + rule.created_at);
                    });
                    model.setProperty("/rows", rows.concat(core));
                }).catch(function (error) { model.setProperty("/error", "AP Core rule history could not be loaded: " + error.message); })
                .finally(function () { model.setProperty("/busy", false); });
        },

        _financeRuleRow: function (rule, stage) {
            return Object.assign({}, rule, {observed: FinanceRuleMessages.observation(rule), stage: stage, state: rule.outcome === "PASS" ? "Success"
                : rule.outcome === "FAIL" ? "Error" : rule.outcome === "WARNING" ? "Warning" : "None"});
        },

        onCloseFinanceRules: function () {
            this.byId("financeRulesDialog").close();
        },

        // A tab is an anchor: it scrolls to its section.
        onTabSelect: function (oEvent) {
            this._scrollTo(oEvent.getParameter("key"));
        },

        // sKey is a section, optionally with what to show there: "info:<sub-tab>" opens an Info tab,
        // "agents:<AGENT>" opens that agent's result, "details:differences" lists only the fields that differ.
        _scrollTo: function (sKey) {
            var that = this;
            var aKey = sKey.split(":");
            var oSection = this.byId("section-" + aKey[0]).getDomRef();
            if (aKey[0] === "info" && aKey[1]) {
                this.getData().setProperty("/infoTabKey", aKey[1]);
            } else if (aKey[0] === "agents" && aKey[1]) {
                this.getCaseStore().selectAgent(aKey[1]);
            } else if (aKey[0] === "details" && aKey[1]) {
                this.getData().setProperty("/selectedInvoice/fieldsDiffOnly", true);
            }
            this.getData().setProperty("/reviewTabKey", aKey[0]);
            if (!oSection) {
                return;
            }
            // While the smooth scroll runs, the sections it passes must not move the tab.
            clearTimeout(this._scrollLock);
            this._scrollLock = setTimeout(function () {
                that._scrollLock = null;
            }, 800);
            oSection.scrollIntoView({ behavior: "smooth", block: "start" });
        },

        // Back to the top of whatever scrolls the page.
        onScrollTop: function () {
            var oScroller = this._scroller();
            if (oScroller) {
                oScroller.scrollTo({ top: 0, behavior: "smooth" });
            }
        },

        // The nearest parent of the panel that scrolls: the page on Home and on #/review.
        _scroller: function () {
            var oNode = this.byId("reviewPanelRoot").getDomRef();
            while (oNode && oNode !== document.body) {
                if (/(auto|scroll)/.test(getComputedStyle(oNode).overflowY) && oNode.scrollHeight > oNode.clientHeight) {
                    return oNode;
                }
                oNode = oNode.parentElement;
            }
            return null;
        },

        // The active tab follows the scroll: the last section whose top has passed the tab bar. The arrow back
        // to the top shows once the page is scrolled down.
        _syncTabToScroll: function () {
            var oBar = this.byId("reviewTabs").getDomRef();
            if (!oBar || !oBar.offsetParent) {
                return;
            }
            var oScroller = this._scroller();
            this.byId("toTop").toggleStyleClass("apToTop--shown", !!oScroller && oScroller.scrollTop > 300);
            // At the very bottom the last sections cannot reach the tab bar, so the tab chosen last stays.
            if (this._scrollLock
                || (oScroller && oScroller.scrollTop + oScroller.clientHeight >= oScroller.scrollHeight - 2)) {
                return;
            }
            var iLine = oBar.getBoundingClientRect().bottom + 8;
            var sKey = SECTIONS.filter(function (sSection) {
                var oSection = this.byId("section-" + sSection).getDomRef();
                return oSection && oSection.getBoundingClientRect().top <= iLine;
            }, this).pop() || SECTIONS[0];
            if (this.getData().getProperty("/reviewTabKey") !== sKey) {
                this.getData().setProperty("/reviewTabKey", sKey);
            }
        },

        _syncProcessorPdf: function () {
            var invoice = this.getData().getProperty("/selectedInvoice");
            var html = this.byId("processorPdf");
            if (!html || !invoice.processor || !invoice.documentUrl) {
                if (html && this._pdfUrl) html.setContent("");
                this._pdfUrl = "";
                return;
            }
            if (this._pdfUrl === invoice.documentUrl && html.getContent()) return;
            this._pdfUrl = invoice.documentUrl;
            this._pendingFocus = null;
            // Same document Blob and iframe mechanism as the existing PDF dialog.
            var src = invoice.documentIsImage ? invoice.documentUrl
                : sap.ui.require.toUrl("saudicargo/ap/automation/pdf/viewer.html") + "#" + encodeURIComponent(invoice.documentUrl);
            html.setContent('<iframe class="apDocFrame apProcessorDocFrame" title="Invoice document" allow="fullscreen" src="'
                + encodeXML(src) + '"></iframe>');
        },

        onToggleSplit: function () {
            this.getData().setProperty("/processorSplit", !this.getData().getProperty("/processorSplit"));
            this._syncProcessorPdf();
        },

        onFocusField: function (event) {
            var field = event.getSource().getBindingContext("apData").getObject();
            if (!field.location) {
                MessageToast.show("No PDF coordinates were supplied for this field.");
                return;
            }
            this.getData().setProperty("/processorSplit", true);
            this._syncProcessorPdf();
            var node = this.byId("processorPdf").getDomRef();
            var frame = node && node.querySelector("iframe");
            this._pendingFocus = {type: "ap-field-focus", location: field.location, label: field.field};
            if (frame) frame.contentWindow.postMessage(this._pendingFocus, window.location.origin);
        },

        _processorAction: function (action, comment) {
            var that = this;
            if (this.getData().getProperty("/processorActionBusy")) return Promise.resolve();
            this.getData().setProperty("/processorActionBusy", true);
            return this._caseRequest("POST", this.getData().getProperty("/selectedInvoice/caseId"),
                "processor/" + action, {comment: comment || ""},
                action === "review" ? "Marked as reviewed; awaiting approval" : action === "flag" ? "Issue reported" : "Extraction queued")
                .catch(function () {}).finally(function () { that.getData().setProperty("/processorActionBusy", false); });
        },

        onMarkReviewed: function () {
            this._processorAction("review");
        },

        onFlagIssue: function () {
            var that = this;
            this._openDecisionDialog({title: "Report exception", label: "Describe the discrepancy", placeholder: "What needs to be resolved?", submitText: "Flag Issue", minLength: 3})
                .then(function (result) { if (result) return that._processorAction("flag", result.text); });
        },

        onRerunExtraction: function () {
            var that = this;
            this._openDecisionDialog({title: "Re-run extraction", label: "Reason for the new AI check", placeholder: "The current extraction and checks will be replaced by a new run.", submitText: "Re-run Extraction", minLength: 3})
                .then(function (result) { if (result) return that._processorAction("rerun", result.text); });
        },

        // View PDF: the invoice opens in a large window, so the review keeps the full width.
        onViewInvoice: function () {
            var oInvoice = this.getData().getProperty("/selectedInvoice");
            var oPreview = oInvoice.documentIsImage
                ? new Image({ src: oInvoice.documentUrl, alt: "Invoice document", densityAware: false })
                : new HTML({
                    content: '<iframe class="apDocFrame" title="Invoice document" src="'
                        + encodeXML(oInvoice.processor ? sap.ui.require.toUrl("saudicargo/ap/automation/pdf/viewer.html") + "#" + encodeURIComponent(oInvoice.documentUrl) : oInvoice.documentUrl) + '"></iframe>'
                });
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

        // "Check comparison" on the SAP data check's row: scroll to Fields and briefly highlight the table.
        onOpenComparison: function () {
            var oCard = this.byId("fieldsCard");
            this._scrollTo("details");
            oCard.removeStyleClass("apHighlight");
            setTimeout(function () {
                oCard.addStyleClass("apHighlight");
            }, 0);
        },

        // An issue's title scrolls to the section where it is resolved (Supplier or Fields).
        onOpenIssue: function (oEvent) {
            this._scrollTo(oEvent.getSource().getBindingContext("apData").getProperty("tab"));
        },

        onSelectAgent: function (oEvent) {
            this.getCaseStore().selectAgent(oEvent.getParameter("listItem").getBindingContext("apData").getProperty("key"));
        },

        onEditFields: function () {
            this.getData().setProperty("/selectedInvoice/editing", true);
        },

        // Cancel puts back the values from before Edit (the fields are shared with the Fields section's cards).
        onCancelEdit: function () {
            var oData = this.getData();
            oData.getProperty("/selectedInvoice/fields").forEach(function (oField) {
                if (oField.editable) {
                    oField.value = oField.original;
                }
            });
            oData.setProperty("/selectedInvoice/editing", false);
            oData.refresh();
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
