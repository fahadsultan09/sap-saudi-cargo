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

    var CASE_LIST_LIMIT = 200;
    var POLL_INTERVAL_MS = 2000;
    var POLL_ATTEMPTS = 60;

    var PROCESSING_STATUSES = ["RECEIVED", "PROCESSING"];
    var REVIEW_STATUSES = ["NEEDS_REVIEW", "RETURNED", "PROCESSING_ERROR", "READY_FOR_APPROVAL", "PENDING_APPROVAL"];
    var APPROVED_STATUSES = ["APPROVED", "POSTING", "POSTED", "POSTING_ERROR"];
    // The agentic API allows field corrections and approval decisions only in these statuses.
    var EDITABLE_STATUSES = ["NEEDS_REVIEW", "RETURNED", "PROCESSING_ERROR"];
    var DECIDABLE_STATUSES = ["NEEDS_REVIEW", "RETURNED"];
    var PROCESSOR_ROLES = ["AP_PROCESSOR", "ADMIN"];
    var APPROVER_ROLES = ["AP_APPROVER", "FINANCE_MANAGER"];

    // Status groups shared by the KPI cards and the case filter on the dashboard.
    var CASE_GROUPS = [
        { key: "processing", label: "In progress", statuses: PROCESSING_STATUSES, icon: "sap-icon://process", tone: "info" },
        { key: "review", label: "Needs review", statuses: REVIEW_STATUSES, icon: "sap-icon://inspect", tone: "warning" },
        { key: "approved", label: "Approved", statuses: APPROVED_STATUSES, icon: "sap-icon://accept", tone: "success" },
        { key: "rejected", label: "Rejected", statuses: ["REJECTED"], icon: "sap-icon://decline", tone: "error" }
    ];

    var STATUS_LABELS = {
        RECEIVED: "Received",
        PROCESSING: "Agents processing",
        NEEDS_REVIEW: "Needs Review",
        READY_FOR_APPROVAL: "Ready for Approval",
        PENDING_APPROVAL: "Pending Approval",
        PROCESSING_ERROR: "Processing Error",
        RETURNED: "Returned",
        APPROVED: "Approved",
        REJECTED: "Rejected",
        POSTING: "Posting",
        POSTED: "Posted",
        POSTING_ERROR: "Posting Error"
    };

    var STATUS_STATES = {
        RECEIVED: "Information",
        PROCESSING: "Information",
        NEEDS_REVIEW: "Warning",
        READY_FOR_APPROVAL: "Information",
        PENDING_APPROVAL: "Warning",
        PROCESSING_ERROR: "Error",
        RETURNED: "Warning",
        APPROVED: "Success",
        REJECTED: "Error",
        POSTING: "Information",
        POSTED: "Success",
        POSTING_ERROR: "Error"
    };

    // Editable invoice fields of the agentic API, in display order.
    var FIELDS = [
        { key: "supplier_name", label: "Supplier", required: true },
        { key: "supplier_id", label: "Supplier ID" },
        { key: "invoice_number", label: "Invoice Number", required: true },
        { key: "invoice_date", label: "Invoice Date (YYYY-MM-DD)" },
        { key: "po_number", label: "PO Number" },
        { key: "currency", label: "Currency", required: true },
        { key: "total_amount", label: "Total Amount", required: true },
        { key: "company_code", label: "Company Code" }
    ];

    var CHECK_LABELS = { vendor: "Vendor", po: "Purchase order", tax: "Tax", duplicate: "Duplicate" };

    var ROLE_LABELS = {
        AP_PROCESSOR: "AP Processor",
        AP_APPROVER: "AP Approver",
        FINANCE_MANAGER: "Finance Manager",
        ADMIN: "Administrator"
    };

    // Timeline colour and icon per audit event type; anything else is shown as information.
    var EVENT_TONES = {
        FIELDS_CORRECTED: ["warning", "sap-icon://edit"],
        APPROVAL_APPROVED: ["success", "sap-icon://accept"],
        APPROVAL_RETURNED: ["warning", "sap-icon://undo"],
        APPROVAL_REJECTED: ["error", "sap-icon://decline"],
        APPROVAL_REJECTD: ["error", "sap-icon://decline"],
        POSTING_WAITING_FOR_INTEGRATION: ["info", "sap-icon://pending"],
        CASE_UPLOADED: ["info", "sap-icon://upload"]
    };

    var UPLOAD_STEPS = [
        { title: "Uploaded", text: "File received", icon: "sap-icon://upload" },
        { title: "Agents processing", text: "TOWER, LENS and rules", icon: "sap-icon://ai" },
        { title: "Ready for review", text: "Case opened", icon: "sap-icon://inspect" }
    ];

    // Readable audit-trail titles per agentic API event type.
    var EVENT_TITLES = {
        CASE_UPLOADED: "Invoice uploaded",
        PROCESSING_STARTED: "Agent processing started",
        PROCESSING_FINISHED: "Agent processing finished",
        FIELDS_CORRECTED: "Fields corrected",
        APPROVAL_APPROVED: "Approved",
        APPROVAL_RETURNED: "Returned to processor",
        APPROVAL_REJECTED: "Rejected",
        APPROVAL_REJECTD: "Rejected",
        POSTING_WAITING_FOR_INTEGRATION: "Waiting for SAP posting integration"
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
                section: "dashboard",
                currentUser: {},
                profiles: [],
                welcome: {},
                busy: false,
                kpiCards: [],
                upload: { visible: false, message: "", state: "None" },
                uploadSteps: this._uploadSteps(-1, false),
                permissions: { processor: false, approver: false },
                statusFilter: "",
                filterOptions: [],
                allCases: [],
                cases: [],
                approvals: [],
                selectedCaseId: "",
                selectedInvoice: { hasCase: false, fields: [], agentTrace: [], checks: [], findings: [] },
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

        onOpenProfileMenu: function (oEvent) {
            var that = this;
            var oAvatar = oEvent.getSource();
            if (this._data().getProperty("/busy")) {
                MessageToast.show("Please wait until the current action finishes.");
                return;
            }
            if (!this._profileMenu) {
                this._profileMenu = Fragment.load({
                    id: this.getView().getId(),
                    name: "saudicargo.ap.automation.view.fragments.ProfileMenu",
                    controller: this
                }).then(function (oPopover) {
                    that.getView().addDependent(oPopover);
                    return oPopover;
                });
            }
            this._profileMenu.then(function (oPopover) {
                oPopover.openBy(oAvatar);
            });
        },

        // A profile switch acts like a new sign-in: close the open case and return to the dashboard.
        onProfileSelect: function (oEvent) {
            var oProfile = oEvent.getParameter("listItem").getBindingContext("apData").getObject();
            this.byId("profileMenu").close();
            this._configModel().setProperty("/currentUserId", oProfile.id);
            this._data().setProperty("/selectedCaseId", "");
            this._revokeDocumentBlob();
            this._showSection("dashboard");
            this._refreshAll();
            MessageToast.show("Switched to " + oProfile.name);
        },

        _profile: function (oUser, sCurrentId) {
            return Object.assign({
                initials: (oUser.name || "?").slice(0, 2).toUpperCase(),
                avatarColor: APPROVER_ROLES.indexOf(oUser.role) >= 0 ? "Accent8" : "Accent6",
                roleLabel: ROLE_LABELS[oUser.role] || oUser.role,
                current: oUser.id === sCurrentId
            }, oUser);
        },

        _applyCurrentUser: function () {
            var oConfig = this._configModel().getData();
            var oUser = this._profile(api.currentUser(oConfig), oConfig.currentUserId);
            var iHour = new Date().getHours();
            var sGreeting = iHour < 12 ? "Good morning" : (iHour < 18 ? "Good afternoon" : "Good evening");
            this._data().setProperty("/currentUser", oUser);
            this._data().setProperty("/profiles", (oConfig.users || []).map(function (oItem) {
                return this._profile(oItem, oUser.id);
            }, this));
            this._data().setProperty("/welcome", {
                greeting: sGreeting + ", " + oUser.name,
                subtitle: oUser.roleLabel + " · " + new Date().toLocaleDateString("en-GB", {
                    weekday: "long", day: "numeric", month: "long", year: "numeric"
                })
            });
            this._data().setProperty("/permissions", {
                processor: PROCESSOR_ROLES.indexOf(oUser.role) >= 0,
                approver: APPROVER_ROLES.indexOf(oUser.role) >= 0
            });
        },

        _refreshAll: function () {
            this._applyCurrentUser();
            this._loadCases();
            var sCaseId = this._data().getProperty("/selectedCaseId");
            if (sCaseId) {
                this._loadCase(sCaseId);
            } else {
                this._applySelectedInvoice(null);
            }
        },

        // ------------------------------------------------------------ navigation

        onToggleSideNav: function () {
            var oToolPage = this.byId("toolPage");
            oToolPage.setSideExpanded(!oToolPage.getSideExpanded());
        },

        onSectionSelect: function (oEvent) {
            var sKey = oEvent.getParameter("item").getKey();
            this._showSection(sKey);
            if (["dashboard", "approvals"].indexOf(sKey) >= 0) {
                this._loadCases();
            }
        },

        _showSection: function (sKey) {
            this._data().setProperty("/section", sKey);
            this.byId("sections").to(this.byId(sKey + "Section"));
        },

        onNavBack: function () {
            this._showSection("dashboard");
            this._loadCases();
        },

        // ---------------------------------------------- dashboard and approvals

        onRefreshCases: function () {
            this._loadCases();
        },

        onStatusFilterPress: function (oEvent) {
            var oButton = oEvent.getSource();
            // Pressing the active filter again must not switch it off.
            oButton.setPressed(true);
            this._data().setProperty("/statusFilter", oButton.getBindingContext("apData").getProperty("key"));
            this._applyStatusFilter();
        },

        // One list call feeds the KPI tiles, the case list and the approval queue.
        _loadCases: function () {
            var that = this;
            return this._call("GET", "/api/v1/cases?limit=" + CASE_LIST_LIMIT).then(function (oList) {
                var aCases = oList.items || [];
                var aGroups = CASE_GROUPS.map(function (oGroup) {
                    return Object.assign({ count: that._countStatuses(aCases, oGroup.statuses) }, oGroup);
                });
                that._data().setProperty("/kpiCards", [
                    { label: "Total invoices", value: aCases.length, icon: "sap-icon://documents", tone: "navy" }
                ].concat(aGroups.map(function (oGroup) {
                    return { label: oGroup.label, value: oGroup.count, icon: oGroup.icon, tone: oGroup.tone };
                })));
                that._data().setProperty("/filterOptions", [{ key: "", text: "All (" + aCases.length + ")" }].concat(
                    aGroups.map(function (oGroup) {
                        return { key: oGroup.key, text: oGroup.label + " (" + oGroup.count + ")" };
                    })
                ));
                that._data().setProperty("/allCases", aCases.map(that._mapCaseToRow.bind(that)));
                that._data().setProperty("/approvals", aCases.filter(function (oCase) {
                    return DECIDABLE_STATUSES.indexOf(oCase.status) >= 0;
                }).map(that._mapCaseToRow.bind(that)));
                that._applyStatusFilter();
            }).catch(this._showError.bind(this));
        },

        _applyStatusFilter: function () {
            var sGroup = this._data().getProperty("/statusFilter");
            var aRows = this._data().getProperty("/allCases");
            var oGroup = CASE_GROUPS.filter(function (oItem) {
                return oItem.key === sGroup;
            })[0];
            this._data().setProperty("/cases", oGroup ? aRows.filter(function (oRow) {
                return oGroup.statuses.indexOf(oRow.statusCode) >= 0;
            }) : aRows);
        },

        _countStatuses: function (aCases, aStatuses) {
            return aCases.filter(function (oCase) {
                return aStatuses.indexOf(oCase.status) >= 0;
            }).length;
        },

        _mapCaseToRow: function (oCase) {
            return {
                caseId: oCase.id,
                id: oCase.invoice_number || oCase.file_name,
                supplier: oCase.supplier_name || "—",
                amount: this._formatAmount(oCase),
                statusCode: oCase.status,
                status: STATUS_LABELS[oCase.status] || oCase.status,
                state: STATUS_STATES[oCase.status] || "None",
                editedBy: oCase.last_edited_by || oCase.created_by,
                date: this._formatDate(oCase.created_at)
            };
        },

        onCasePress: function (oEvent) {
            this._openCase(oEvent.getSource().getBindingContext("apData").getObject().caseId);
        },

        _openCase: function (sCaseId) {
            this._data().setProperty("/selectedCaseId", sCaseId);
            this._showSection("review");
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
                this._data().setProperty("/selectedInvoice", { hasCase: false, fields: [], agentTrace: [], checks: [], findings: [] });
                this._data().setProperty("/auditTrail", []);
                return;
            }
            this._data().setProperty("/selectedInvoice", this._mapCaseToSelectedInvoice(oCase));
        },

        _mapCaseToSelectedInvoice: function (oCase) {
            var oValidation = oCase.validation || {};
            var oClassification = oValidation.ai_core || {};
            var oPermissions = this._data().getProperty("/permissions");
            var sStatus = oCase.status;

            return {
                hasCase: true,
                caseId: oCase.id,
                id: oCase.invoice_number || oCase.file_name,
                supplier: oCase.supplier_name || "Unknown supplier",
                status: STATUS_LABELS[sStatus] || sStatus,
                statusState: STATUS_STATES[sStatus] || "None",
                reviewReason: oCase.review_reason || "",
                documentType: oCase.document_type || oClassification.document_type || "—",
                classificationConfidence: typeof oClassification.confidence === "number"
                    ? Math.round(oClassification.confidence * 100) + "%" : "—",
                agentMode: oValidation.agent_mode || "—",
                agentTrace: (oValidation.agent_trace || []).map(function (oStep) {
                    var bDone = oStep.status === "completed";
                    return {
                        title: oStep.agent + " — " + oStep.status,
                        description: oStep.summary || "",
                        meta: oStep.duration_ms != null ? oStep.duration_ms + " ms" : "",
                        tone: bDone ? "success" : "warning",
                        icon: bDone ? "sap-icon://accept" : "sap-icon://alert"
                    };
                }),
                checks: Object.keys(CHECK_LABELS).map(function (sKey) {
                    var sValue = String((oValidation.checks || {})[sKey] || "not_checked");
                    return { name: CHECK_LABELS[sKey], value: sValue.replace(/_/g, " "), state: this._checkState(sValue) };
                }, this),
                findings: this._mapFindings(oValidation),
                fields: this._mapFields(oCase, oValidation),
                fileName: oCase.file_name,
                createdBy: oCase.created_by,
                editedBy: oCase.last_edited_by || "—",
                documentUrl: "",
                canEdit: oPermissions.processor && EDITABLE_STATUSES.indexOf(sStatus) >= 0,
                canDecide: oPermissions.approver && DECIDABLE_STATUSES.indexOf(sStatus) >= 0
            };
        },

        _checkState: function (sValue) {
            var sLower = sValue.toLowerCase();
            if (["passed", "pass", "valid", "clear", "no_duplicate"].indexOf(sLower) >= 0) {
                return "Success";
            }
            return sLower === "not_checked" ? "None" : "Error";
        },

        _mapFindings: function (oValidation) {
            var aFindings = (oValidation.blocking || []).map(function (sFlag) {
                return { text: sFlag.replace(/_/g, " ").toLowerCase(), icon: "sap-icon://alert" };
            });
            ((oValidation.review_decision || {}).reasons || []).forEach(function (sReason) {
                aFindings.push({ text: sReason, icon: "sap-icon://hint" });
            });
            (oValidation.missing_fields || []).forEach(function (sField) {
                aFindings.push({ text: "Missing field: " + sField.replace(/_/g, " "), icon: "sap-icon://edit" });
            });
            return aFindings;
        },

        _mapFields: function (oCase, oValidation) {
            var aMissing = oValidation.missing_fields || [];
            return FIELDS.map(function (oField) {
                var sValue = oCase[oField.key] == null ? "" : String(oCase[oField.key]);
                return {
                    key: oField.key,
                    field: oField.label,
                    value: sValue,
                    original: sValue,
                    needsAttention: (oField.required && !sValue) || aMissing.indexOf(oField.key) >= 0
                };
            });
        },

        _loadDocumentPreview: function (oCase) {
            var that = this;
            this._revokeDocumentBlob();
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

        onSaveCorrections: function () {
            var that = this;
            var oChanges = {};
            this._data().getProperty("/selectedInvoice/fields").forEach(function (oField) {
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
                return that._caseRequest("PATCH", "fields", { fields: oChanges, comment: oResult.text }, "Corrections saved");
            }).catch(function () { });
        },

        onApproveInvoice: function (oEvent) {
            this._decide(oEvent, "approve", "Approve invoice", "Approve", "Invoice approved");
        },

        onReturnInvoice: function (oEvent) {
            this._decide(oEvent, "return", "Return to processor", "Return", "Case returned to processor");
        },

        onRejectInvoice: function (oEvent) {
            this._decide(oEvent, "reject", "Reject invoice", "Reject", "Invoice rejected");
        },

        // Decisions work from the review screen and from approval-queue rows.
        _decide: function (oEvent, sAction, sTitle, sSubmitText, sSuccessText) {
            var that = this;
            var oRowContext = oEvent.getSource().getBindingContext("apData");
            var oRow = oRowContext && oRowContext.getObject();
            var sCaseId = oRow && oRow.caseId ? oRow.caseId : this._data().getProperty("/selectedInvoice/caseId");
            this._openDecisionDialog({
                title: sTitle,
                label: "Comment",
                placeholder: "Reason for this decision",
                submitText: sSubmitText
            }).then(function (oResult) {
                return oResult && that._caseRequest("POST", sAction, { comment: oResult.text }, sSuccessText, sCaseId);
            }).catch(function () { });
        },

        _caseRequest: function (sMethod, sAction, oBody, sSuccessText, sCaseId) {
            var that = this;
            var sId = sCaseId || this._data().getProperty("/selectedInvoice/caseId");
            BusyIndicator.show(0);
            return this._call(sMethod, "/api/v1/cases/" + encodeURIComponent(sId) + "/" + sAction, oBody)
                .then(function (oResult) {
                    MessageToast.show(sSuccessText + " — status: " + (STATUS_LABELS[oResult.status] || oResult.status));
                    that._loadCases();
                    if (that._data().getProperty("/selectedCaseId") === sId) {
                        that._loadCase(sId);
                    }
                }).catch(function (oError) {
                    MessageBox.error(oError.message);
                    throw oError;
                }).finally(function () {
                    BusyIndicator.hide();
                });
        },

        // --------------------------------------------------------------- dialog

        _openDecisionDialog: function (oOptions) {
            var that = this;
            this.getView().getModel("dialog").setData(Object.assign({
                title: "", label: "", placeholder: "", submitText: "OK", text: ""
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
            this._closeDecisionDialog({ text: this.getView().getModel("dialog").getProperty("/text").trim() });
        },

        onDecisionDialogCancel: function () {
            this._closeDecisionDialog(null);
        },

        _closeDecisionDialog: function (oResult) {
            this.byId("decisionDialog").close();
            this._resolveDecision(oResult);
        },

        // ---------------------------------------------------------- audit trail

        _applyHistory: function (oHistory) {
            this._data().setProperty("/auditTrail", (oHistory.events || []).slice().reverse().map(function (oEvent) {
                var aTone = EVENT_TONES[oEvent.event_type] || ["info", "sap-icon://ai"];
                return {
                    tone: aTone[0],
                    icon: aTone[1],
                    title: EVENT_TITLES[oEvent.event_type] || oEvent.event_type.replace(/_/g, " ").toLowerCase(),
                    description: this._eventDescription(oEvent),
                    meta: oEvent.actor_id + " (" + oEvent.actor_role + ") · " + this._formatDate(oEvent.created_at)
                };
            }, this));
        },

        _eventDescription: function (oEvent) {
            var aParts = oEvent.reason ? [oEvent.reason] : [];
            if (oEvent.event_type === "FIELDS_CORRECTED" && oEvent.after) {
                Object.keys(oEvent.after).forEach(function (sKey) {
                    var vBefore = (oEvent.before || {})[sKey];
                    aParts.push(sKey.replace(/_/g, " ") + ": " + (vBefore || "—") + " → " + oEvent.after[sKey]);
                });
            } else if (oEvent.after && oEvent.after.status) {
                aParts.push("Status: " + (STATUS_LABELS[oEvent.after.status] || oEvent.after.status));
            }
            return aParts.join(" · ");
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

        // Upload returns at once; the agents run in the background, so the case is polled until they finish.
        _uploadInvoiceFile: function (oFile) {
            var that = this;
            var oFormData = new FormData();
            oFormData.append("file", oFile, oFile.name);

            this._setUploadStep(0, false, "Uploading " + oFile.name + "…", "Information");
            this._data().setProperty("/busy", true);

            this._call("POST", "/api/v1/cases/upload", oFormData).then(function (oAccepted) {
                that._setUploadStep(1, false, "Agents are reading the invoice…", "Information");
                return that._waitForProcessing(oAccepted.case_id);
            }).then(function (oCase) {
                var bDone = PROCESSING_STATUSES.indexOf(oCase.status) < 0;
                that._setUploadStep(bDone ? UPLOAD_STEPS.length : 1, false, bDone
                    ? "Processed — status: " + (STATUS_LABELS[oCase.status] || oCase.status)
                    : "Still processing — check the case list in a moment", bDone ? "Success" : "Warning");
                that._loadCases();
                that._openCase(oCase.id);
            }).catch(function (oError) {
                var iFailed = that._data().getProperty("/uploadSteps").findIndex(function (oStep) {
                    return oStep.state === "active";
                });
                that._setUploadStep(Math.max(iFailed, 0), true, "Upload failed", "Error");
                MessageBox.error(oError.message);
            }).finally(function () {
                that._data().setProperty("/busy", false);
                that.byId("fileUploader").clear();
            });
        },

        _waitForProcessing: function (sCaseId) {
            var that = this;
            var iAttempt = 0;
            var sPath = "/api/v1/cases/" + encodeURIComponent(sCaseId);
            function poll() {
                return that._call("GET", sPath).then(function (oCase) {
                    iAttempt += 1;
                    if (PROCESSING_STATUSES.indexOf(oCase.status) < 0 || iAttempt >= POLL_ATTEMPTS) {
                        return oCase;
                    }
                    return new Promise(function (resolve) {
                        setTimeout(resolve, POLL_INTERVAL_MS);
                    }).then(poll);
                });
            }
            return poll();
        },

        // Steps before iActive are done and iActive is running or failed; past the last step all are done.
        _uploadSteps: function (iActive, bFailed) {
            return UPLOAD_STEPS.map(function (oStep, i) {
                var sState = "pending";
                if (i < iActive) {
                    sState = "done";
                } else if (i === iActive) {
                    sState = bFailed ? "error" : "active";
                }
                return Object.assign({ state: sState }, oStep);
            });
        },

        _setUploadStep: function (iActive, bFailed, sMessage, sState) {
            this._data().setProperty("/uploadSteps", this._uploadSteps(iActive, bFailed));
            this._data().setProperty("/upload", { visible: true, message: sMessage, state: sState });
        },

        onGoUpload: function () {
            this._showSection("upload");
        },

        onGoQueue: function () {
            this._showSection("approvals");
            this._loadCases();
        },

        // ------------------------------------------------------------- helpers

        _formatAmount: function (oCase) {
            var fNum = Number(oCase.total_amount);
            if (oCase.total_amount == null || oCase.total_amount === "" || isNaN(fNum)) {
                return "—";
            }
            return fNum.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                + (oCase.currency ? " " + oCase.currency : "");
        },

        _formatDate: function (sIso) {
            return sIso ? String(sIso).slice(0, 16).replace("T", " ") : "";
        },

        onTableUpdateFinished: function (oEvent) {
            oEvent.getSource().getItems().forEach(function (oItem, i) {
                oItem.getCells()[0].setText(String(i + 1));
            });
        },

        onExit: function () {
            this._revokeDocumentBlob();
        }
    });
});
