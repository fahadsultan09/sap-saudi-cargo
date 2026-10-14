sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/Fragment",
    "sap/ui/core/BusyIndicator",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "saudicargo/ap/automation/model/api"
], function (Controller, Fragment, BusyIndicator, JSONModel, MessageToast, MessageBox, api) {
    "use strict";

    var PENDING_STATUSES = [
        "RECEIVED",
        "NEEDS_REVIEW",
        "EXTRACTED",
        "WAITING_EXTERNAL",
        "AWAITING_CONFIRM",
        "AWAITING_APPROVAL",
        "RETURNED"
    ];
    var APPROVED_STATUSES = [
        "READY_TO_POST",
        "POSTING",
        "POST_UNKNOWN",
        "POST_FAILED",
        "RECONCILIATION_FAILED"
    ];
    var POSTED_STATUSES = ["POSTED", "RECONCILED", "INFORMED"];
    var EDITABLE_STATUSES = ["NEEDS_REVIEW", "EXTRACTED", "RETURNED"];
    var CLOSED_STATUSES = [
        "POSTING", "POST_UNKNOWN", "POST_FAILED", "POSTED",
        "RECONCILIATION_FAILED", "RECONCILED", "INFORMED", "REJECTED"
    ];
    var CASE_LIST_LIMIT = 200;
    // Same as the backend's CONFIDENCE_THRESHOLD: lower values must be confirmed by a person.
    var CONFIDENCE_THRESHOLD = 0.85;

    var STATUS_LABELS = {
        RECEIVED: "Pending",
        NEEDS_REVIEW: "Review Required",
        EXTRACTED: "Extracted",
        WAITING_EXTERNAL: "Waiting External",
        AWAITING_CONFIRM: "Awaiting Confirm",
        AWAITING_APPROVAL: "Pending Approval",
        RETURNED: "Returned",
        READY_TO_POST: "Approved",
        POSTING: "Posting",
        POST_UNKNOWN: "Post Unknown",
        POST_FAILED: "Post Failed",
        POSTED: "Posted",
        RECONCILIATION_FAILED: "Reconciliation Failed",
        RECONCILED: "Reconciled",
        INFORMED: "Informed",
        REJECTED: "Rejected"
    };

    var STATUS_STATES = {
        RECEIVED: "Information",
        NEEDS_REVIEW: "Warning",
        EXTRACTED: "Information",
        WAITING_EXTERNAL: "Warning",
        AWAITING_CONFIRM: "Warning",
        AWAITING_APPROVAL: "Warning",
        RETURNED: "Warning",
        READY_TO_POST: "Success",
        POSTING: "Information",
        POST_UNKNOWN: "Warning",
        POST_FAILED: "Error",
        POSTED: "Success",
        RECONCILIATION_FAILED: "Error",
        RECONCILED: "Success",
        INFORMED: "Success",
        REJECTED: "Error"
    };

    var FIELD_LABELS = {
        vendor: "Vendor",
        invoice_number: "Invoice Number",
        po_number: "PO Number",
        net: "Net Amount",
        vat: "VAT Amount",
        currency: "Currency"
    };

    var FIELD_ORDER = ["vendor", "invoice_number", "po_number", "net", "vat", "currency"];

    var ACTION_LABELS = {
        POST: "POST",
        HOLD: "HOLD",
        REJECT: "REJECT"
    };

    // Readable audit-trail entries per backend event kind.
    var EVENT_TEXTS = {
        case_created: function (d) { return ["Case created", "Source: " + d.source]; },
        document_stored: function (d) { return ["Document stored", d.filename]; },
        document_extracted: function () { return ["Fields extracted by Document AI", ""]; },
        extraction_failed: function (d) { return ["Extraction failed", d.code]; },
        field_corrected: function (d) {
            return ["Field corrected: " + (FIELD_LABELS[d.field] || d.field), (d.old || "—") + " → " + d.new];
        },
        review_completed: function (d) { return ["Review completed", d.ready ? "All fields complete" : "Fields still incomplete"]; },
        agent_unavailable: function (d) { return ["Agent unavailable", d.reason]; },
        agent_investigated: function (d) { return ["Agent investigated", (d.trace || []).join(", ")]; },
        tool_called: function (d) { return ["Agent looked up " + d.name, JSON.stringify(d.args)]; },
        rule_evaluated: function (d) { return ["Rule " + d.code + (d.passed ? " passed" : " failed"), d.evidence]; },
        recommendation_created: function (d) { return ["Recommendation: " + d.action, d.reason]; },
        recommendation_confirmed: function (d) { return ["Recommendation confirmed: " + d.action, "Source: " + d.source]; },
        package_created: function (d) { return ["Posting package created", "Gross " + d.gross]; },
        package_approved: function (d) { return ["Approved", d.comment || ""]; },
        case_returned: function (d) { return ["Returned to processor", d.comment]; },
        case_rejected: function (d) { return ["Rejected", d.reason]; },
        case_resumed: function () { return ["Resumed", ""]; },
        vendor_informed: function (d) { return ["Vendor informed", d.channel + ": " + d.reference]; },
        dispatch_claimed: function () { return ["SAP posting started", ""]; },
        sap_posted: function (d) { return ["Posted to SAP", "Document " + d.document_id]; },
        sap_posting_rejected: function (d) { return ["SAP refused the posting", d.code]; },
        posting_outcome_unknown: function (d) { return ["SAP posting outcome unknown", d.code]; },
        sap_reconciled: function (d) {
            return ["Reconciled with SAP", (d.differences || []).length ? "Differences: " + d.differences.join(", ") : "No differences"];
        },
        status_changed: function (d) {
            return ["Status: " + (STATUS_LABELS[d.to] || d.to), "From " + (STATUS_LABELS[d.from] || d.from)];
        }
    };

    return Controller.extend("saudicargo.ap.automation.controller.App", {
        onInit: function () {
            this._documentBlobUrl = null;
            this.getOwnerComponent().setModel(new JSONModel(this._emptyData()), "apData");
            this.getView().setModel(new JSONModel({}), "dialog");
            this._configModel().dataLoaded().then(this._refreshAll.bind(this));
        },

        _emptyData: function () {
            return {
                currentUser: {},
                busy: false,
                permissions: { processor: false, approver: false },
                kpis: { total: 0, pending: 0, approved: 0, posted: 0, rejected: 0 },
                statusFilter: "",
                statusOptions: [{ key: "", text: "All statuses" }].concat(
                    Object.keys(STATUS_LABELS).map(function (sKey) {
                        return { key: sKey, text: STATUS_LABELS[sKey] };
                    })
                ),
                cases: [],
                approvals: [],
                selectedCaseId: "",
                selectedInvoice: { hasCase: false, extractedFields: [], reasons: [] },
                auditTrail: []
            };
        },

        _configModel: function () {
            return this.getOwnerComponent().getModel("config");
        },

        _data: function () {
            return this.getOwnerComponent().getModel("apData");
        },

        _call: function (sMethod, sPath, vBody) {
            return api.json(this._configModel().getData(), sMethod, sPath, vBody);
        },

        _showError: function (oError) {
            MessageBox.error(oError.message);
        },

        // ---------------------------------------------------------------- users

        // A user switch acts like a new sign-in: close the open case and return to the dashboard.
        onUserChange: function () {
            this._data().setProperty("/selectedCaseId", "");
            this._revokeDocumentBlob();
            this.byId("idIconTabBar").setSelectedKey("dashboard");
            this._refreshAll();
        },

        onNavBack: function () {
            this.byId("idIconTabBar").setSelectedKey("dashboard");
            this._loadDashboard();
        },

        _applyCurrentUser: function () {
            var oUser = api.currentUser(this._configModel().getData());
            var sRole = oUser.role || "";
            this._data().setProperty("/currentUser", oUser);
            this._data().setProperty("/permissions", {
                processor: sRole === "AP_PROCESSOR" || sRole === "ADMIN",
                approver: sRole === "AP_APPROVER" || sRole === "ADMIN"
            });
        },

        _refreshAll: function () {
            this._applyCurrentUser();
            this._loadDashboard();
            this._loadApprovals();
            var sCaseId = this._data().getProperty("/selectedCaseId");
            if (sCaseId) {
                this._loadCase(sCaseId);
            } else {
                this._applySelectedInvoice(null);
            }
        },

        onTabSelect: function (oEvent) {
            var sKey = oEvent.getParameter("key");
            if (sKey === "dashboard") {
                this._loadDashboard();
            } else if (sKey === "approvals") {
                this._loadApprovals();
            }
        },

        // ------------------------------------------------------------ dashboard

        onRefreshCases: function () {
            this._loadDashboard();
        },

        _loadDashboard: function () {
            var that = this;
            var sStatus = this._data().getProperty("/statusFilter");
            var sQuery = "?limit=" + CASE_LIST_LIMIT + (sStatus ? "&status=" + sStatus : "");
            return Promise.all([
                this._call("GET", "/api/v1/dashboard"),
                this._call("GET", "/api/v1/cases" + sQuery)
            ]).then(function (aResults) {
                that._applyDashboard(aResults[0], aResults[1]);
            }).catch(this._showError.bind(this));
        },

        _applyDashboard: function (oDashboard, oCaseList) {
            var mCounts = oDashboard.counts || {};
            this._data().setProperty("/kpis", {
                total: oDashboard.total || 0,
                pending: this._sumCounts(mCounts, PENDING_STATUSES),
                approved: this._sumCounts(mCounts, APPROVED_STATUSES),
                posted: this._sumCounts(mCounts, POSTED_STATUSES),
                rejected: mCounts.REJECTED || 0
            });
            this._data().setProperty("/cases", (oCaseList.items || []).map(this._mapCaseToRow.bind(this)));
        },

        _sumCounts: function (mCounts, aStatuses) {
            return aStatuses.reduce(function (iSum, sStatus) {
                return iSum + (mCounts[sStatus] || 0);
            }, 0);
        },

        _mapCaseToRow: function (oCase) {
            var sStatus = oCase.status || "";
            var oInvoice = oCase.invoice || {};
            var oRec = oCase.recommendation;
            return {
                id: this._fieldOrInvoice(oCase, "invoice_number") || oCase.id,
                caseId: oCase.id,
                vendor: this._fieldOrInvoice(oCase, "vendor") || "—",
                gross: oInvoice.net ? this._formatMoney(Number(oInvoice.net) + Number(oInvoice.vat || 0)) + " " + (oInvoice.currency || "") : "—",
                recommendation: oRec ? ACTION_LABELS[oRec.action] + " (" + oRec.source + ")" : "—",
                confirmedBy: oCase.confirmed_by || "—",
                status: STATUS_LABELS[sStatus] || sStatus,
                state: STATUS_STATES[sStatus] || "None",
                date: this._formatDate(oCase.created_at)
            };
        },

        onCasePress: function (oEvent) {
            var oRow = oEvent.getSource().getBindingContext("apData").getObject();
            this._openCase(oRow.caseId);
        },

        _openCase: function (sCaseId) {
            this._data().setProperty("/selectedCaseId", sCaseId);
            this.byId("idIconTabBar").setSelectedKey("review");
            this._loadCase(sCaseId);
        },

        // --------------------------------------------------------------- review

        _loadCase: function (sCaseId) {
            var that = this;
            var sPath = "/api/v1/cases/" + encodeURIComponent(sCaseId);
            return Promise.all([
                this._call("GET", sPath),
                this._call("GET", sPath + "/history")
            ]).then(function (aResults) {
                that._applySelectedInvoice(aResults[0]);
                that._applyHistory(aResults[1]);
                that._loadDocumentPreview(aResults[0]);
            }).catch(this._showError.bind(this));
        },

        _applySelectedInvoice: function (oCase) {
            if (!oCase) {
                this._data().setProperty("/selectedInvoice", { hasCase: false, extractedFields: [], reasons: [] });
                this._data().setProperty("/auditTrail", []);
                return;
            }
            this._data().setProperty("/selectedInvoice", this._mapCaseToSelectedInvoice(oCase));
        },

        _mapCaseToSelectedInvoice: function (oCase) {
            var oRec = oCase.recommendation || null;
            var sStatus = oCase.status || "";
            var oDoc = oCase.document || {};
            var oPermissions = this._data().getProperty("/permissions");
            var bProcessor = oPermissions.processor;
            var bApprover = oPermissions.approver;

            return {
                hasCase: true,
                caseId: oCase.id,
                id: this._fieldOrInvoice(oCase, "invoice_number") || oCase.id,
                vendor: this._fieldOrInvoice(oCase, "vendor") || "Unknown vendor",
                status: STATUS_LABELS[sStatus] || sStatus,
                statusState: STATUS_STATES[sStatus] || "None",
                recommendation: oRec ? ACTION_LABELS[oRec.action] : (sStatus === "AWAITING_CONFIRM" ? "Manual decision needed" : "—"),
                recommendationState: oRec ? (oRec.action === "POST" ? "Success" : (oRec.action === "REJECT" ? "Error" : "Warning")) : "None",
                source: oRec ? (oRec.source === "agent" ? "AI agent" : "Manual (" + (oCase.confirmed_by || "user") + ")") : "—",
                confidence: oRec && typeof oRec.confidence === "number" ? Math.round(oRec.confidence * 100) + "%" : "—",
                reasons: this._mapReasons(oCase, oRec),
                extractedFields: this._mapExtractedFields(oCase),
                hasDocument: !!oCase.document,
                documentFilename: oDoc.filename || "No document (case created from data)",
                documentUrl: "",
                confirmedBy: oCase.confirmed_by || "—",
                approvedBy: oCase.approved_by || "—",
                sapDocument: oCase.sap_document_id || "—",
                canEdit: bProcessor && EDITABLE_STATUSES.indexOf(sStatus) >= 0,
                canCompleteReview: bProcessor && sStatus === "NEEDS_REVIEW",
                canDecide: bProcessor && (sStatus === "EXTRACTED" || sStatus === "RETURNED"),
                canConfirm: bProcessor && sStatus === "AWAITING_CONFIRM" && !!oRec,
                canDecideManually: bProcessor && sStatus === "AWAITING_CONFIRM" && !oRec,
                canResume: bProcessor && sStatus === "WAITING_EXTERNAL",
                canApprove: bApprover && sStatus === "AWAITING_APPROVAL",
                canReject: (bProcessor || bApprover) && CLOSED_STATUSES.indexOf(sStatus) < 0,
                canInform: bProcessor && sStatus === "RECONCILED"
            };
        },

        _fieldOrInvoice: function (oCase, sKey) {
            var oField = (oCase.fields || {})[sKey];
            if (oField && oField.value != null && oField.value !== "") {
                return String(oField.value);
            }
            var oInvoice = oCase.invoice || {};
            return oInvoice[sKey] != null ? String(oInvoice[sKey]) : "";
        },

        _mapExtractedFields: function (oCase) {
            var that = this;
            return FIELD_ORDER.map(function (sKey) {
                var oField = (oCase.fields || {})[sKey] || {};
                var sValue = that._fieldOrInvoice(oCase, sKey);
                var fConf = typeof oField.confidence === "number" ? oField.confidence : null;
                return {
                    key: sKey,
                    field: FIELD_LABELS[sKey],
                    value: sValue,
                    original: sValue,
                    needsConfirmation: !sValue || fConf == null || fConf < CONFIDENCE_THRESHOLD,
                    confidence: fConf == null ? "n/a" : Math.round(fConf * 100) + "%",
                    state: that._confidenceState(fConf)
                };
            });
        },

        _confidenceState: function (fConf) {
            if (fConf == null) {
                return "Warning";
            }
            if (fConf >= CONFIDENCE_THRESHOLD) {
                return "Success";
            }
            return fConf >= 0.5 ? "Warning" : "Error";
        },

        _mapReasons: function (oCase, oRec) {
            var aReasons = [];
            if (oRec) {
                aReasons.push({ text: oRec.reason, icon: "sap-icon://lightbulb" });
                (oRec.evidence || []).forEach(function (sText) {
                    aReasons.push({ text: sText, icon: "sap-icon://documents" });
                });
            }
            (oCase.rules || []).forEach(function (oRule) {
                aReasons.push({
                    text: oRule.code + ": " + oRule.evidence,
                    icon: oRule.passed ? "sap-icon://accept" : "sap-icon://decline"
                });
            });
            if (!aReasons.length) {
                aReasons.push({
                    text: oCase.status === "NEEDS_REVIEW"
                        ? "Extraction incomplete — complete the fields below"
                        : "No recommendation yet",
                    icon: "sap-icon://hint"
                });
            }
            return aReasons;
        },

        _loadDocumentPreview: function (oCase) {
            var that = this;
            this._revokeDocumentBlob();
            if (!oCase.document) {
                return;
            }
            api.blob(this._configModel().getData(), "/api/v1/cases/" + encodeURIComponent(oCase.id) + "/document")
                .then(function (oBlob) {
                    that._documentBlobUrl = URL.createObjectURL(oBlob);
                    that._data().setProperty("/selectedInvoice/documentUrl", that._documentBlobUrl);
                }).catch(function (oError) {
                    MessageToast.show("Document unavailable: " + oError.message);
                });
        },

        _revokeDocumentBlob: function () {
            if (this._documentBlobUrl) {
                URL.revokeObjectURL(this._documentBlobUrl);
                this._documentBlobUrl = null;
            }
        },

        onOpenDocument: function () {
            window.open(this._data().getProperty("/selectedInvoice/documentUrl"), "_blank");
        },

        // Sends changed fields plus low-confidence ones, so a correct but uncertain value can be confirmed as is.
        onSaveCorrections: function () {
            var aFields = this._data().getProperty("/selectedInvoice/extractedFields");
            var oChanges = {};
            var aMissing = [];
            aFields.forEach(function (oField) {
                var sValue = String(oField.value || "").trim();
                if (!sValue) {
                    aMissing.push(oField.field);
                } else if (sValue !== oField.original || oField.needsConfirmation) {
                    oChanges[oField.key] = sValue;
                }
            });
            if (!Object.keys(oChanges).length) {
                MessageToast.show(aMissing.length ? "Fill in: " + aMissing.join(", ") : "No changes to save");
                return;
            }
            this._runCaseAction("review", oChanges, "Fields saved").then(function () {
                if (aMissing.length) {
                    MessageBox.warning("Saved. Still missing before the case can continue: " + aMissing.join(", "));
                }
            }).catch(function () {});
        },

        _runCaseAction: function (sAction, vBody, sSuccessText) {
            var that = this;
            var sCaseId = this._data().getProperty("/selectedInvoice/caseId");
            return this._caseAction(sCaseId, sAction, vBody).then(function (oCase) {
                MessageToast.show(sSuccessText + " — status: " + (STATUS_LABELS[oCase.status] || oCase.status));
                that._afterAction(sCaseId);
            });
        },

        _caseAction: function (sCaseId, sAction, vBody) {
            BusyIndicator.show(0);
            return this._call("POST", "/api/v1/cases/" + encodeURIComponent(sCaseId) + "/" + sAction, vBody)
                .catch(function (oError) {
                    MessageBox.error(oError.message);
                    throw oError;
                }).finally(function () {
                    BusyIndicator.hide();
                });
        },

        _afterAction: function (sCaseId) {
            this._loadCase(sCaseId);
            this._loadDashboard();
            this._loadApprovals();
        },

        onDecide: function () {
            this._runCaseAction("decide", undefined, "Recommendation requested").catch(function () {});
        },

        onConfirm: function () {
            this._runCaseAction("confirm", undefined, "Recommendation confirmed").catch(function () {});
        },

        onResume: function () {
            this._runCaseAction("resume", undefined, "Case resumed").catch(function () {});
        },

        onDecideManually: function () {
            var that = this;
            this._openDecisionDialog({
                title: "Manual decision",
                showAction: true,
                label: "Reason",
                placeholder: "Why this decision? e.g. checked against PO and goods receipt",
                submitText: "Confirm decision"
            }).then(function (oResult) {
                return oResult && that._runCaseAction("confirm", { action: oResult.action, reason: oResult.text }, "Decision confirmed");
            }).catch(function () {});
        },

        onApproveInvoice: function (oEvent) {
            this._decideWithComment(oEvent, "approve", {
                title: "Approve invoice",
                label: "Approval comment",
                placeholder: "e.g. Amounts and PO verified",
                submitText: "Approve"
            }, "comment", "Invoice approved");
        },

        onReturnInvoice: function (oEvent) {
            this._decideWithComment(oEvent, "return", {
                title: "Return to processor",
                label: "What needs to be corrected?",
                placeholder: "e.g. VAT amount does not match the invoice",
                submitText: "Return"
            }, "comment", "Case returned to processor");
        },

        onRejectInvoice: function (oEvent) {
            this._decideWithComment(oEvent, "reject", {
                title: "Reject invoice",
                label: "Rejection reason",
                placeholder: "e.g. Duplicate of an invoice already posted",
                submitText: "Reject"
            }, "reason", "Invoice rejected");
        },

        onInformVendor: function () {
            var that = this;
            this._openDecisionDialog({
                title: "Inform vendor",
                showChannel: true,
                label: "Reference (e.g. email subject or ticket number)",
                placeholder: "e.g. MAIL-2026-001",
                submitText: "Record"
            }).then(function (oResult) {
                return oResult && that._runCaseAction("inform", { channel: oResult.channel, reference: oResult.text }, "Vendor notification recorded");
            }).catch(function () {});
        },

        // Approve/return/reject work from the review screen and from approval-queue rows.
        _decideWithComment: function (oEvent, sAction, oDialog, sBodyKey, sSuccessText) {
            var that = this;
            var oRowContext = oEvent.getSource().getBindingContext("apData");
            var oRow = oRowContext && oRowContext.getObject();
            var sCaseId = oRow && oRow.caseId ? oRow.caseId : this._data().getProperty("/selectedInvoice/caseId");
            this._openDecisionDialog(oDialog).then(function (oResult) {
                if (!oResult) {
                    return null;
                }
                var oBody = {};
                oBody[sBodyKey] = oResult.text;
                return that._caseAction(sCaseId, sAction, oBody).then(function (oCase) {
                    MessageToast.show(sSuccessText + " — status: " + (STATUS_LABELS[oCase.status] || oCase.status));
                    that._afterAction(sCaseId);
                });
            }).catch(function () {});
        },

        // --------------------------------------------------------------- dialog

        _openDecisionDialog: function (oOptions) {
            var that = this;
            this.getView().getModel("dialog").setData(Object.assign({
                title: "", label: "", placeholder: "", submitText: "OK", text: "",
                showAction: false, action: "POST", showChannel: false, channel: "email"
            }, oOptions));
            if (!this._decisionDialog) {
                this._decisionDialog = Fragment.load({
                    id: this.getView().getId(),
                    name: "saudicargo.ap.automation.view.fragments.DecisionDialog",
                    controller: this
                }).then(function (oDialog) {
                    that.getView().addDependent(oDialog);
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
            var oData = this.getView().getModel("dialog").getData();
            this._closeDecisionDialog({ action: oData.action, channel: oData.channel, text: oData.text.trim() });
        },

        onDecisionDialogCancel: function () {
            this._closeDecisionDialog(null);
        },

        _closeDecisionDialog: function (oResult) {
            this.byId("decisionDialog").close();
            this._resolveDecision(oResult);
        },

        // ------------------------------------------------------------ approvals

        _loadApprovals: function () {
            var that = this;
            return this._call("GET", "/api/v1/cases?status=AWAITING_APPROVAL&limit=" + CASE_LIST_LIMIT)
                .then(function (oList) {
                    that._data().setProperty("/approvals", (oList.items || []).map(that._mapCaseToRow.bind(that)));
                }).catch(this._showError.bind(this));
        },

        // ---------------------------------------------------------- audit trail

        _applyHistory: function (oHistory) {
            this._data().setProperty("/auditTrail", (oHistory.events || []).slice().reverse().map(function (oEvent) {
                var fText = EVENT_TEXTS[oEvent.kind];
                var aText = fText ? fText(oEvent.data || {}) : [oEvent.kind.replace(/_/g, " "), JSON.stringify(oEvent.data)];
                return {
                    title: aText[0],
                    description: aText[1] || "",
                    actor: oEvent.actor,
                    time: this._formatDate(oEvent.timestamp)
                };
            }, this));
        },

        // --------------------------------------------------------------- upload

        onUploadChange: function (oEvent) {
            var oFile = (oEvent.getParameter("files") || [])[0];
            if (!oFile) {
                MessageToast.show("No file selected");
                return;
            }
            this._uploadInvoiceFile(oFile);
        },

        _uploadInvoiceFile: function (oFile) {
            var that = this;
            var oProgress = this.byId("uploadProgress");
            var oFormData = new FormData();

            this.byId("processingSection").setVisible(true);
            oProgress.setState("Information");
            oProgress.setPercentValue(45);
            oProgress.setDisplayValue("Uploading and extracting with SAP Document AI…");
            oFormData.append("file", oFile, oFile.name);
            // The user switch stays locked until the upload finishes, so the result opens for the uploader.
            this._data().setProperty("/busy", true);

            this._call("POST", "/api/v1/cases/upload", oFormData).then(function (oCase) {
                oProgress.setPercentValue(100);
                oProgress.setState("Success");
                oProgress.setDisplayValue("Case created — status: " + (STATUS_LABELS[oCase.status] || oCase.status));
                that._loadDashboard();
                that._openCase(oCase.id);
            }).catch(function (oError) {
                // Document AI may fail after the case was saved for manual review.
                var sCaseId = that._caseIdFromMessage(oError.body && oError.body.error && oError.body.error.message);
                oProgress.setPercentValue(100);
                oProgress.setState(sCaseId ? "Warning" : "Error");
                oProgress.setDisplayValue(sCaseId ? "Case saved — fields need manual entry" : "Upload failed");
                MessageBox[sCaseId ? "warning" : "error"](oError.message);
                if (sCaseId) {
                    that._loadDashboard();
                    that._openCase(sCaseId);
                }
            }).finally(function () {
                that._data().setProperty("/busy", false);
                that.byId("fileUploader").clear();
            });
        },

        _caseIdFromMessage: function (sMessage) {
            var aMatch = String(sMessage || "").match(/case\s+([0-9a-f]{32})/i);
            return aMatch ? aMatch[1] : "";
        },

        // ------------------------------------------------------------- helpers

        _formatMoney: function (vValue) {
            var fNum = Number(vValue);
            if (vValue == null || vValue === "" || isNaN(fNum)) {
                return "—";
            }
            return fNum.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        },

        _formatDate: function (sIso) {
            return sIso ? String(sIso).slice(0, 16).replace("T", " ") : "";
        },

        onExit: function () {
            this._revokeDocumentBlob();
        }
    });
});
