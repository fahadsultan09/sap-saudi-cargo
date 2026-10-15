sap.ui.define([
    "sap/ui/base/Object",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "saudicargo/ap/automation/model/api",
    "saudicargo/ap/automation/model/constants"
], function (BaseObject, JSONModel, MessageToast, MessageBox, api, C) {
    "use strict";

    // Loads cases from the gateway and maps them into the shared "apData" model that every screen binds to.
    return BaseObject.extend("saudicargo.ap.automation.model.CaseStore", {
        constructor: function (oConfigModel) {
            BaseObject.call(this);
            this._config = oConfigModel;
            this._documentBlobUrl = null;
            this._refreshTimer = null;
            this._processingIds = [];
            this._model = new JSONModel({
                section: "dashboard",
                currentUser: {},
                profiles: [],
                welcome: {},
                busy: false,
                kpiCards: [],
                upload: { visible: false, message: "", state: "None" },
                permissions: { processor: false, approver: false },
                statusFilter: "",
                filterOptions: [],
                allCases: [],
                cases: [],
                page: { index: 0, count: 1, text: "", range: "" },
                pagedCases: [],
                approvals: [],
                selectedCaseId: "",
                selectedInvoice: this._emptyInvoice(),
                auditTrail: []
            });
        },

        getModel: function () {
            return this._model;
        },

        call: function (sMethod, sPath, vBody) {
            return api.json(this._config.getData(), sMethod, sPath, vBody);
        },

        casePath: function (sCaseId) {
            return "/api/v1/cases/" + encodeURIComponent(sCaseId);
        },

        // Dates are shown in the time zone of the configured country (UTC if the code is unknown).
        applyTimeZone: function () {
            var oZone = C.COUNTRY_TIME_ZONES[this._config.getProperty("/countryCode")] || C.DEFAULT_TIME_ZONE;
            this._dateFormat = new Intl.DateTimeFormat("en-CA", {
                timeZone: oZone.zone,
                year: "numeric", month: "2-digit", day: "2-digit",
                hour: "2-digit", minute: "2-digit", hourCycle: "h23"
            });
            this._model.setProperty("/timeZoneLabel", oZone.label);
        },

        // ---------------------------------------------------------------- users

        applyCurrentUser: function () {
            var oConfig = this._config.getData();
            var oUser = this._profile(api.currentUser(oConfig), oConfig.currentUserId);
            var iHour = new Date().getHours();
            var sGreeting = iHour < 12 ? "Good morning" : (iHour < 18 ? "Good afternoon" : "Good evening");
            this._model.setProperty("/currentUser", oUser);
            this._model.setProperty("/profiles", (oConfig.users || []).map(function (oItem) {
                return this._profile(oItem, oUser.id);
            }, this));
            this._model.setProperty("/welcome", {
                greeting: sGreeting + ", " + oUser.name,
                subtitle: oUser.roleLabel + " · " + new Date().toLocaleDateString("en-GB", {
                    weekday: "long", day: "numeric", month: "long", year: "numeric"
                })
            });
            this._model.setProperty("/permissions", {
                processor: C.PROCESSOR_ROLES.indexOf(oUser.role) >= 0,
                approver: C.APPROVER_ROLES.indexOf(oUser.role) >= 0
            });
        },

        _profile: function (oUser, sCurrentId) {
            return Object.assign({
                initials: (oUser.name || "?").slice(0, 2).toUpperCase(),
                avatarColor: C.APPROVER_ROLES.indexOf(oUser.role) >= 0 ? "Accent8" : "Accent7",
                roleLabel: C.ROLE_LABELS[oUser.role] || oUser.role,
                current: oUser.id === sCurrentId
            }, oUser);
        },

        // ---------------------------------------------------------- case list

        // One list call feeds the KPI tiles, the case list and the approval queue.
        loadCases: function () {
            var that = this;
            return this.call("GET", "/api/v1/cases?limit=" + C.CASE_LIST_LIMIT).then(function (oList) {
                var aCases = oList.items || [];
                var aGroups = C.CASE_GROUPS.map(function (oGroup) {
                    return Object.assign({ count: that._countStatuses(aCases, oGroup.statuses) }, oGroup);
                });
                that._model.setProperty("/kpiCards", [
                    { label: "Total invoices", value: aCases.length, icon: "sap-icon://documents", tone: "brand" }
                ].concat(aGroups.map(function (oGroup) {
                    return { label: oGroup.label, value: oGroup.count, icon: oGroup.icon, tone: oGroup.tone };
                })));
                that._model.setProperty("/filterOptions", [{ key: "", text: "All (" + aCases.length + ")" }].concat(
                    aGroups.map(function (oGroup) {
                        return { key: oGroup.key, text: oGroup.label + " (" + oGroup.count + ")" };
                    })
                ));
                that._model.setProperty("/allCases", aCases.map(that._mapCaseToRow.bind(that)));
                that._model.setProperty("/approvals", aCases.filter(function (oCase) {
                    return C.DECIDABLE_STATUSES.indexOf(oCase.status) >= 0;
                }).map(that._mapCaseToRow.bind(that)));
                that.applyStatusFilter();
                that._watchProcessing(aCases);
            }).catch(this._showError);
        },

        // While the agents work on a case, the list refreshes itself; when they finish, the user is told
        // and an open case is reloaded with its results.
        _watchProcessing: function (aCases) {
            var that = this;
            var aProcessing = aCases.filter(function (oCase) {
                return C.PROCESSING_STATUSES.indexOf(oCase.status) >= 0;
            });
            aCases.forEach(function (oCase) {
                if (that._processingIds.indexOf(oCase.id) >= 0 && aProcessing.indexOf(oCase) < 0) {
                    MessageToast.show((oCase.invoice_number || oCase.file_name) + " processed — status: "
                        + (C.STATUS_LABELS[oCase.status] || oCase.status));
                    if (that._model.getProperty("/selectedCaseId") === oCase.id) {
                        that.loadCase(oCase.id);
                    }
                }
            });
            this._processingIds = aProcessing.map(function (oCase) {
                return oCase.id;
            });
            clearTimeout(this._refreshTimer);
            if (aProcessing.length) {
                this._refreshTimer = setTimeout(this.loadCases.bind(this), C.REFRESH_INTERVAL_MS);
            }
        },

        // A new filter starts at the first page; a refresh keeps the current page.
        applyStatusFilter: function (bFirstPage) {
            var sGroup = this._model.getProperty("/statusFilter");
            var aRows = this._model.getProperty("/allCases");
            var oGroup = C.CASE_GROUPS.filter(function (oItem) {
                return oItem.key === sGroup;
            })[0];
            this._model.setProperty("/cases", oGroup ? aRows.filter(function (oRow) {
                return oGroup.statuses.indexOf(oRow.statusCode) >= 0;
            }) : aRows);
            this.showPage(bFirstPage ? 0 : this._model.getProperty("/page/index"));
        },

        showPage: function (iIndex) {
            var aCases = this._model.getProperty("/cases");
            var iCount = Math.max(1, Math.ceil(aCases.length / C.CASES_PER_PAGE));
            var iPage = Math.min(Math.max(iIndex, 0), iCount - 1);
            var iFrom = iPage * C.CASES_PER_PAGE;
            var aPage = aCases.slice(iFrom, iFrom + C.CASES_PER_PAGE);
            var sRows = aPage.length > 1 ? (iFrom + 1) + "–" + (iFrom + aPage.length) : String(iFrom + 1);
            this._model.setProperty("/pagedCases", aPage);
            this._model.setProperty("/page", {
                index: iPage,
                count: iCount,
                text: "Page " + (iPage + 1) + " of " + iCount,
                range: "Showing " + sRows + " of " + aCases.length
            });
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
                status: C.STATUS_LABELS[oCase.status] || oCase.status,
                state: C.STATUS_STATES[oCase.status] || "None",
                processing: C.PROCESSING_STATUSES.indexOf(oCase.status) >= 0,
                editedBy: oCase.last_edited_by || oCase.created_by,
                date: this._formatDate(oCase.created_at)
            };
        },

        // --------------------------------------------------------- one case

        loadCase: function (sCaseId) {
            var that = this;
            var sPath = this.casePath(sCaseId);
            this._model.setProperty("/selectedCaseId", sCaseId);
            return Promise.all([
                this.call("GET", sPath),
                this.call("GET", sPath + "/history")
            ]).then(function (aResults) {
                that._model.setProperty("/selectedInvoice", that._mapCaseToSelectedInvoice(aResults[0]));
                that._applyHistory(aResults[1]);
                that._loadDocument(aResults[0]);
            }).catch(this._showError);
        },

        clearCase: function () {
            this._revokeDocument();
            this._model.setProperty("/selectedCaseId", "");
            this._model.setProperty("/selectedInvoice", this._emptyInvoice());
            this._model.setProperty("/auditTrail", []);
        },

        // After a correction or decision: refresh the lists and, if it is open, the case itself.
        reloadAfterChange: function (sCaseId) {
            this.loadCases();
            if (this._model.getProperty("/selectedCaseId") === sCaseId) {
                this.loadCase(sCaseId);
            }
        },

        _emptyInvoice: function () {
            return { hasCase: false, fields: [], agentTrace: [], checks: [], findings: [], reviewReasons: [] };
        },

        _mapCaseToSelectedInvoice: function (oCase) {
            var oValidation = oCase.validation || {};
            var oClassification = oValidation.ai_core || {};
            var oPermissions = this._model.getProperty("/permissions");
            var sStatus = oCase.status;

            return {
                hasCase: true,
                caseId: oCase.id,
                id: oCase.invoice_number || oCase.file_name,
                supplier: oCase.supplier_name || "Unknown supplier",
                status: C.STATUS_LABELS[sStatus] || sStatus,
                statusState: C.STATUS_STATES[sStatus] || "None",
                reviewReasons: this._mapReviewReasons(oCase, oValidation),
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
                checks: Object.keys(C.CHECK_LABELS).map(function (sKey) {
                    var sValue = String((oValidation.checks || {})[sKey] || "not_checked");
                    return { name: C.CHECK_LABELS[sKey], value: sValue.replace(/_/g, " "), state: this._checkState(sValue) };
                }, this),
                findings: this._mapFindings(oValidation),
                fields: this._mapFields(oCase, oValidation),
                fileName: oCase.file_name,
                createdBy: oCase.created_by,
                editedBy: oCase.last_edited_by || "—",
                documentUrl: "",
                canEdit: oPermissions.processor && C.EDITABLE_STATUSES.indexOf(sStatus) >= 0,
                canDecide: oPermissions.approver && C.DECIDABLE_STATUSES.indexOf(sStatus) >= 0
            };
        },

        _checkState: function (sValue) {
            var sLower = sValue.toLowerCase();
            if (["passed", "pass", "valid", "clear", "no_duplicate"].indexOf(sLower) >= 0) {
                return "Success";
            }
            return sLower === "not_checked" ? "None" : "Error";
        },

        // One line per review reason code; a case without codes shows its review note as is.
        _mapReviewReasons: function (oCase, oValidation) {
            var aCodes = (oValidation.review_decision || {}).reason_codes || [];
            if (!aCodes.length) {
                return oCase.review_reason ? [{ icon: "sap-icon://hint", text: oCase.review_reason }] : [];
            }
            var aTexts = oValidation.review_decision.reasons || [];
            return aCodes.map(function (sCode, i) {
                var aReason = C.REVIEW_REASONS[sCode] || ["sap-icon://hint", aTexts[i] || sCode];
                return { icon: aReason[0], text: aReason[1] };
            });
        },

        _mapFindings: function (oValidation) {
            var aFindings = (oValidation.blocking || []).map(function (sFlag) {
                return { text: sFlag.replace(/_/g, " ").toLowerCase(), icon: "sap-icon://alert" };
            });
            (oValidation.missing_fields || []).forEach(function (sField) {
                aFindings.push({ text: "Missing field: " + sField.replace(/_/g, " "), icon: "sap-icon://edit" });
            });
            return aFindings;
        },

        _mapFields: function (oCase, oValidation) {
            var aMissing = oValidation.missing_fields || [];
            return C.FIELDS.map(function (oField) {
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

        // ------------------------------------------------------------- document

        _loadDocument: function (oCase) {
            var that = this;
            this._revokeDocument();
            api.blob(this._config.getData(), this.casePath(oCase.id) + "/document")
                .then(function (oBlob) {
                    that._documentBlobUrl = URL.createObjectURL(oBlob);
                    that._model.setProperty("/selectedInvoice/documentUrl", that._documentBlobUrl);
                }).catch(function (oError) {
                    MessageToast.show("Document unavailable: " + oError.message);
                });
        },

        _revokeDocument: function () {
            if (this._documentBlobUrl) {
                URL.revokeObjectURL(this._documentBlobUrl);
                this._documentBlobUrl = null;
            }
        },

        // ---------------------------------------------------------- audit trail

        _applyHistory: function (oHistory) {
            this._model.setProperty("/auditTrail", (oHistory.events || []).slice().reverse().map(function (oEvent) {
                var aTone = C.EVENT_TONES[oEvent.event_type] || ["info", "sap-icon://ai"];
                return {
                    tone: aTone[0],
                    icon: aTone[1],
                    title: C.EVENT_TITLES[oEvent.event_type] || oEvent.event_type.replace(/_/g, " ").toLowerCase(),
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
                aParts.push("Status: " + (C.STATUS_LABELS[oEvent.after.status] || oEvent.after.status));
            }
            return aParts.join(" · ");
        },

        // ------------------------------------------------------------- helpers

        _showError: function (oError) {
            MessageBox.error(oError.message);
        },

        _formatAmount: function (oCase) {
            var fNum = Number(oCase.total_amount);
            if (oCase.total_amount == null || oCase.total_amount === "" || isNaN(fNum)) {
                return "—";
            }
            return fNum.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                + (oCase.currency ? " " + oCase.currency : "");
        },

        // "2026-10-15T10:17:23+00:00" → "2026-10-15 13:17" for Saudi Arabia.
        _formatDate: function (sIso) {
            if (!sIso) {
                return "";
            }
            var mParts = {};
            this._dateFormat.formatToParts(new Date(sIso)).forEach(function (oPart) {
                mParts[oPart.type] = oPart.value;
            });
            return mParts.year + "-" + mParts.month + "-" + mParts.day + " " + mParts.hour + ":" + mParts.minute;
        },

        destroy: function () {
            clearTimeout(this._refreshTimer);
            this._revokeDocument();
            this._model.destroy();
            BaseObject.prototype.destroy.apply(this, arguments);
        }
    });
});
