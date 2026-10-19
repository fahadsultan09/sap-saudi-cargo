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
        // oClientModel: this deployment's client profile (branding, country, role labels) from /config/client.
        constructor: function (oClientModel) {
            BaseObject.call(this);
            this._client = oClientModel;
            this._documentBlobUrl = null;
            this._refreshTimer = null;
            this._casePollTimer = null;
            this._documentCaseId = null;
            this._processingIds = [];
            this._model = new JSONModel({
                section: "dashboard",
                currentUser: {},
                welcome: {},
                busy: false,
                kpiCards: [],
                upload: {
                    visible: false,
                    message: "",
                    state: "None",
                    fileName: "",
                    watching: false,
                    nowText: "",
                    progressPercent: 0
                },
                uploadSteps: [],
                permissions: { processor: false, approver: false },
                statusFilter: "",
                filterOptions: [],
                allCases: [],
                cases: [],
                page: { index: 0, count: 1, text: "", range: "" },
                pagedCases: [],
                approvals: [],
                pipelineBanner: "",
                pipelineBannerDots: [],
                reviewTabKey: "agents",
                selectedCaseId: "",
                selectedInvoice: this._emptyInvoice(),
                auditTrail: []
            });
        },

        getModel: function () {
            return this._model;
        },

        call: function (sMethod, sPath, vBody) {
            return api.json(sMethod, sPath, vBody);
        },

        casePath: function (sCaseId) {
            return "/api/v1/cases/" + encodeURIComponent(sCaseId);
        },

        // Dates are shown in the time zone of the configured country (UTC if the code is unknown).
        applyTimeZone: function () {
            var oZone = C.COUNTRY_TIME_ZONES[this._client.getProperty("/countryCode")] || C.DEFAULT_TIME_ZONE;
            this._dateFormat = new Intl.DateTimeFormat("en-CA", {
                timeZone: oZone.zone,
                year: "numeric", month: "2-digit", day: "2-digit",
                hour: "2-digit", minute: "2-digit", hourCycle: "h23"
            });
            this._model.setProperty("/timeZoneLabel", oZone.label);
        },

        // ---------------------------------------------------------------- users

        // oMe: the signed-in user from /auth/me. A user with several roles acts with the first one in the
        // client profile's role list.
        applyCurrentUser: function (oMe) {
            var aRoles = this._client.getProperty("/roles") || [];
            var oRole = aRoles.filter(function (oItem) {
                return oMe.roles.indexOf(oItem.id) >= 0;
            })[0] || { id: "", label: "No role assigned" };
            var iHour = new Date().getHours();
            var sGreeting = iHour < 12 ? "Good morning" : (iHour < 18 ? "Good afternoon" : "Good evening");
            this._model.setProperty("/currentUser", {
                id: oMe.userId,
                name: oMe.name,
                email: oMe.email,
                role: oRole.id,
                roleLabel: oRole.label,
                initials: oMe.name.split(/\s+/).map(function (sPart) {
                    return sPart.charAt(0);
                }).join("").slice(0, 2).toUpperCase(),
                avatarColor: C.APPROVER_ROLES.indexOf(oRole.id) >= 0 ? "Accent8" : "Accent7"
            });
            this._model.setProperty("/welcome", {
                greeting: sGreeting + ", " + oMe.name.split(/\s+/)[0],
                subtitle: oRole.label + " · " + new Date().toLocaleDateString("en-GB", {
                    weekday: "long", day: "numeric", month: "long", year: "numeric"
                })
            });
            this._model.setProperty("/permissions", {
                processor: C.PROCESSOR_ROLES.indexOf(oRole.id) >= 0,
                approver: C.APPROVER_ROLES.indexOf(oRole.id) >= 0
            });
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
                that._model.setProperty("/pipelineBanner", that._pipelineBanner(aCases));
                that._model.setProperty("/pipelineBannerDots", that._pipelineBannerDots(aCases));
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
            var bProcessing = C.PROCESSING_STATUSES.indexOf(oCase.status) >= 0;
            var sHint = "";
            var aDots = [];
            if (bProcessing) {
                sHint = oCase.status === "RECEIVED"
                    ? "Full cycle: Received → Classify → Extract → Finance → Review"
                    : "Full cycle live — open to watch every step";
                aDots = this._pipelineDotsFromStatus(oCase.status);
            }
            return {
                caseId: oCase.id,
                id: oCase.invoice_number || oCase.file_name,
                supplier: oCase.supplier_name || "—",
                amount: this._formatAmount(oCase),
                statusCode: oCase.status,
                status: C.STATUS_LABELS[oCase.status] || oCase.status,
                state: C.STATUS_STATES[oCase.status] || "None",
                processing: bProcessing,
                pipelineHint: sHint,
                pipelineDots: aDots,
                editedBy: oCase.last_edited_by || oCase.created_by,
                date: this._formatDate(oCase.created_at)
            };
        },

        // Short dashboard hint while any case is still in the agent pipeline.
        _pipelineBanner: function (aCases) {
            var iProcessing = aCases.filter(function (oCase) {
                return C.PROCESSING_STATUSES.indexOf(oCase.status) >= 0;
            }).length;
            if (!iProcessing) {
                return "";
            }
            return iProcessing === 1
                ? "1 invoice is live in the full pipeline — open it to watch all five steps."
                : iProcessing + " invoices are live in the full pipeline — open a case to watch the cycle.";
        },

        // Banner legend: all five steps as a mini process map while anything is processing.
        _pipelineBannerDots: function (aCases) {
            var bAny = (aCases || []).some(function (oCase) {
                return C.PROCESSING_STATUSES.indexOf(oCase.status) >= 0;
            });
            if (!bAny) {
                return [];
            }
            return C.PIPELINE_STEPS.map(function (oDef, iIndex) {
                var sState = "pending";
                if (iIndex === 0) {
                    sState = "done";
                } else if (iIndex <= 2) {
                    sState = "running";
                }
                return {
                    key: oDef.key,
                    title: oDef.title,
                    short: oDef.title.split(" ")[0],
                    state: sState
                };
            });
        },

        // Status-only mini rail for dashboard rows (full fidelity is on Upload / Review).
        _pipelineDotsFromStatus: function (sStatus) {
            var aStates;
            if (sStatus === "RECEIVED") {
                aStates = ["done", "running", "pending", "pending", "pending"];
            } else if (sStatus === "PROCESSING") {
                aStates = ["done", "done", "running", "pending", "pending"];
            } else if (sStatus === "PROCESSING_ERROR") {
                aStates = ["done", "failed", "pending", "pending", "pending"];
            } else {
                return [];
            }
            return C.PIPELINE_STEPS.map(function (oDef, iIndex) {
                return {
                    key: oDef.key,
                    title: oDef.title,
                    short: oDef.title.split(" ")[0],
                    state: aStates[iIndex] || "pending"
                };
            });
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
                that._scheduleCasePoll(aResults[0]);
            }).catch(this._showError);
        },

        // While Clear Desk is open on a processing case, keep the pipeline rail live.
        _scheduleCasePoll: function (oCase) {
            var that = this;
            clearTimeout(this._casePollTimer);
            this._casePollTimer = null;
            if (!oCase || this._model.getProperty("/selectedCaseId") !== oCase.id) {
                return;
            }
            if (C.PROCESSING_STATUSES.indexOf(oCase.status) < 0) {
                return;
            }
            this._casePollTimer = setTimeout(function () {
                if (that._model.getProperty("/selectedCaseId") !== oCase.id) {
                    return;
                }
                // Pause while the user is on another screen; Review restarts via route match.
                if (that._model.getProperty("/section") !== "review") {
                    return;
                }
                that.loadCase(oCase.id);
            }, C.PIPELINE_POLL_MS);
        },

        // Shared mapper for Upload stay-and-watch and Review Agent Results.
        buildPipelineFromCase: function (oCase) {
            return this._mapPipelineSteps(oCase || {}, (oCase && oCase.validation) || {});
        },

        pipelineProgress: function (aSteps) {
            // Steps that did not run (agents skipped, details entered by hand) are not part of the count.
            var aList = (aSteps || []).filter(function (oStep) {
                return oStep.state !== "skipped";
            });
            var iDone = aList.filter(function (oStep) {
                return oStep.state === "done";
            }).length;
            var oRunning = aList.filter(function (oStep) {
                return oStep.state === "running";
            })[0];
            var iTotal = Math.max(aList.length, 1);
            // Count a running step as half-complete so the rail advances while agents work.
            var fScore = iDone + (oRunning ? 0.45 : 0);
            var iPercent = Math.max(0, Math.min(100, Math.round((fScore / iTotal) * 100)));
            var sNow = "";
            if (oRunning) {
                sNow = oRunning.nowLabel || C.PIPELINE_NOW_LABELS[oRunning.key]
                    || ("Working on " + oRunning.title + "…");
            } else if (iDone >= iTotal) {
                sNow = "Pipeline complete — ready on Clear Desk.";
            } else {
                sNow = "Waiting for the next agent step…";
            }
            return {
                percent: iPercent,
                nowText: sNow,
                doneCount: iDone,
                total: iTotal,
                runningKey: oRunning ? oRunning.key : ""
            };
        },

        clearCase: function () {
            clearTimeout(this._casePollTimer);
            this._casePollTimer = null;
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
            return {
                hasCase: false,
                fields: [],
                agentTrace: [],
                pipelineSteps: [],
                checks: [],
                findings: [],
                reviewReasons: [],
                fieldsGuidance: "",
                isProcessing: false,
                pipelineNow: "",
                pipelinePercent: 0,
                pipelineSummary: ""
            };
        },

        _mapCaseToSelectedInvoice: function (oCase) {
            var oValidation = oCase.validation || {};
            var oClassification = oValidation.ai_core || {};
            var oPermissions = this._model.getProperty("/permissions");
            var sStatus = oCase.status;
            var aFields = this._mapFields(oCase, oValidation);
            var aPipeline = this._mapPipelineSteps(oCase, oValidation);
            var oProgress = this.pipelineProgress(aPipeline);
            var bProcessing = C.PROCESSING_STATUSES.indexOf(sStatus) >= 0;
            var sExistingUrl = "";
            var bExistingImage = false;
            if (this._documentCaseId === oCase.id && this._documentBlobUrl) {
                sExistingUrl = this._model.getProperty("/selectedInvoice/documentUrl") || "";
                bExistingImage = !!this._model.getProperty("/selectedInvoice/documentIsImage");
            }

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
                pipelineSteps: aPipeline,
                isProcessing: bProcessing,
                pipelineNow: oProgress.nowText,
                pipelinePercent: oProgress.percent,
                pipelineSummary: oProgress.doneCount + " of " + oProgress.total + " steps complete",
                agentTrace: aPipeline.filter(function (oStep) {
                    return !!oStep.agent;
                }),
                checks: Object.keys(C.CHECK_LABELS).map(function (sKey) {
                    var sValue = String((oValidation.checks || {})[sKey] || "not_checked");
                    return { name: C.CHECK_LABELS[sKey], value: sValue.replace(/_/g, " "), state: this._checkState(sValue) };
                }, this),
                findings: this._mapFindings(oValidation),
                fields: aFields,
                fieldsGuidance: this._fieldsGuidance(sStatus, oPermissions.processor, aFields),
                fileName: oCase.file_name,
                createdBy: oCase.created_by,
                editedBy: oCase.last_edited_by || "—",
                documentUrl: sExistingUrl,
                documentIsImage: bExistingImage,
                canEdit: oPermissions.processor && C.EDITABLE_STATUSES.indexOf(sStatus) >= 0,
                canDecide: oPermissions.approver && C.DECIDABLE_STATUSES.indexOf(sStatus) >= 0
            };
        },

        // Maps case status + validation.agent_trace into the full Received → … → Approve timeline.
        // When trace is empty (common in mock / mid-flight), status still drives an honest demo-friendly rail.
        _mapPipelineSteps: function (oCase, oValidation) {
            var aTrace = oValidation.agent_trace || [];
            var oByAgent = {};
            aTrace.forEach(function (oStep) {
                oByAgent[oStep.agent] = oStep;
            });
            var sStatus = oCase.status;
            var bProcessing = C.PROCESSING_STATUSES.indexOf(sStatus) >= 0;
            var bError = sStatus === "PROCESSING_ERROR";
            var bNeedsHuman = ["NEEDS_REVIEW", "RETURNED", "READY_FOR_APPROVAL", "PENDING_APPROVAL"].indexOf(sStatus) >= 0;
            // An invoice awaiting approval is the approver's turn, so everyone else sees it as waiting.
            var bAwaitingApproval = C.DECIDABLE_STATUSES.indexOf(sStatus) >= 0
                && !this._model.getProperty("/permissions/approver");
            var bApproved = ["APPROVED", "POSTING", "POSTED"].indexOf(sStatus) >= 0;
            var bRejected = sStatus === "REJECTED";
            var bPastAgents = bNeedsHuman || bApproved || bRejected || bError;
            var sRunningAgent = this._inferRunningAgent(aTrace, oByAgent, bProcessing);

            return C.PIPELINE_STEPS.map(function (oDef) {
                var oTrace = oDef.agent ? oByAgent[oDef.agent] : null;
                var sState = "pending";
                var sDescription = oDef.description;
                var aMeta = [];

                if (oDef.service) {
                    aMeta.push(oDef.service);
                }

                if (oDef.key === "receive") {
                    sState = "done";
                    sDescription = oCase.file_name
                        ? "Received “" + oCase.file_name + "” and opened a case."
                        : oDef.description;
                } else if (oDef.key === "decide") {
                    if (bApproved) {
                        sState = "done";
                        sDescription = "Decision recorded — invoice approved.";
                    } else if (bRejected) {
                        sState = "failed";
                        sDescription = "Decision recorded — invoice rejected.";
                    } else if (bAwaitingApproval) {
                        sState = "running";
                        sDescription = "Waiting for an approver to approve, return or reject on Dock Decide.";
                    } else if (bNeedsHuman) {
                        sState = "running";
                        sDescription = sStatus === "RETURNED"
                            ? "Returned for corrections on Clear Desk before Dock Decide."
                            : "Open Clear Desk to check fields, then use Dock Decide.";
                    } else if (bError) {
                        sState = "pending";
                        sDescription = "Fix extraction on Clear Desk, then send for approval.";
                    } else {
                        sState = "pending";
                    }
                } else if (oTrace) {
                    sState = this._traceToPipelineState(oTrace.status);
                    if (oTrace.summary) {
                        sDescription = oTrace.summary;
                    }
                    if (oTrace.duration_ms != null) {
                        aMeta.push(oTrace.duration_ms + " ms");
                    }
                } else if (bPastAgents && !bError) {
                    // No per-step trace: AP Core's own checks always ran, the agents only if they delivered fields.
                    if (oDef.key === "finance" || oValidation.agents_completed) {
                        sState = "done";
                    } else {
                        sState = "skipped";
                        sDescription = "Did not run — the invoice details were entered on Clear Desk.";
                    }
                } else if (bError) {
                    // An agent without a trace never ran; with no trace at all, processing stopped at the first one.
                    if (!aTrace.length && oDef.agent === "TOWER") {
                        sState = "failed";
                        sDescription = "Automatic processing stopped during classification or extraction.";
                    } else {
                        sState = "pending";
                    }
                } else if (bProcessing && oDef.agent && oDef.agent === sRunningAgent) {
                    sState = "running";
                    sDescription = oDef.description;
                } else if (bProcessing && oDef.agent && this._agentIndex(oDef.agent) < this._agentIndex(sRunningAgent)) {
                    sState = "done";
                } else if (bProcessing && sStatus === "RECEIVED" && oDef.agent === "TOWER") {
                    // File accepted; agents about to start — show Classify as live immediately.
                    sState = "running";
                }

                var sNowLabel = "";
                if (sState === "running") {
                    sNowLabel = C.PIPELINE_NOW_LABELS[oDef.key] || ("Working on " + oDef.title + "…");
                    // The decide step keeps its own text: who acts next (processor or approver).
                    if (oDef.key !== "decide" && (!oTrace || !oTrace.summary)) {
                        sDescription = sNowLabel;
                    }
                } else if (sState === "done" && oDef.key !== "receive" && oDef.key !== "decide" && !oTrace) {
                    sDescription = oDef.description + " — complete.";
                }

                var sStatusLabel = C.PIPELINE_STATUS_LABELS[sState] || sState;
                // Decide is a human step on Clear Desk — not an agent "Working…" cue.
                if (oDef.key === "decide" && sState === "running" && bNeedsHuman) {
                    sStatusLabel = bAwaitingApproval ? "Awaiting approval" : "Your turn";
                    sNowLabel = "";
                }

                return {
                    key: oDef.key,
                    agent: oDef.agent || "",
                    title: oDef.title,
                    service: oDef.service || "",
                    description: sDescription,
                    nowLabel: sNowLabel,
                    meta: aMeta.join(" · "),
                    state: sState,
                    statusLabel: sStatusLabel,
                    tone: sState === "done" ? "success"
                        : sState === "failed" ? "error"
                            : sState === "running" ? "info" : "muted",
                    icon: sState === "done" ? "sap-icon://accept"
                        : sState === "failed" ? "sap-icon://error"
                            : sState === "skipped" ? "sap-icon://less"
                            : (sState === "running" && oDef.key !== "decide") ? "sap-icon://synchronize"
                                : (sState === "running" ? "sap-icon://approvals" : oDef.icon)
                };
            }, this);
        },

        _traceToPipelineState: function (sStatus) {
            var s = String(sStatus || "").toLowerCase();
            if (s === "completed" || s === "skipped" || s === "done") {
                return "done";
            }
            if (s === "failed" || s === "error") {
                return "failed";
            }
            if (s === "running" || s === "in_progress" || s === "processing") {
                return "running";
            }
            return "pending";
        },

        _agentIndex: function (sAgent) {
            var aOrder = ["TOWER", "LENS", "FINANCE_RULES"];
            var i = aOrder.indexOf(sAgent);
            return i < 0 ? aOrder.length : i;
        },

        // Next agent that has not completed yet while the case is still PROCESSING/RECEIVED.
        _inferRunningAgent: function (aTrace, oByAgent, bProcessing) {
            if (!bProcessing) {
                return null;
            }
            var aOrder = ["TOWER", "LENS", "FINANCE_RULES"];
            var i;
            for (i = 0; i < aOrder.length; i++) {
                var oStep = oByAgent[aOrder[i]];
                if (!oStep) {
                    return aOrder[i];
                }
                var sState = this._traceToPipelineState(oStep.status);
                if (sState === "running") {
                    return aOrder[i];
                }
                if (sState === "failed") {
                    return aOrder[i];
                }
                if (sState !== "done") {
                    return aOrder[i];
                }
            }
            return "FINANCE_RULES";
        },

        _checkState: function (sValue) {
            var sLower = sValue.toLowerCase();
            if (["passed", "pass", "valid", "clear", "no_duplicate"].indexOf(sLower) >= 0) {
                return "Success";
            }
            // "unknown": an agent could not decide (e.g. no PO number), which is not a failure.
            return ["not_checked", "unknown"].indexOf(sLower) >= 0 ? "None" : "Error";
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
                return { text: C.BLOCKING_TEXTS[sFlag] || sFlag.replace(/_/g, " ").toLowerCase(), icon: "sap-icon://alert" };
            });
            (oValidation.missing_fields || []).forEach(function (sField) {
                aFindings.push({ text: "Missing field: " + sField.replace(/_/g, " "), icon: "sap-icon://edit" });
            });
            return aFindings;
        },

        // Plain-language guidance above the fields table — most specific for a failed extraction,
        // otherwise just points at whatever is still marked as needing attention.
        _fieldsGuidance: function (sStatus, bCanEditRole, aFields) {
            if (!bCanEditRole || C.EDITABLE_STATUSES.indexOf(sStatus) < 0) {
                return "";
            }
            var iMissing = aFields.filter(function (oField) {
                return oField.needsAttention;
            }).length;
            if (sStatus === "PROCESSING_ERROR") {
                return "Automatic extraction failed for this invoice. Enter the fields below using the PDF as reference"
                    + (iMissing ? " — " + iMissing + " still need a value." : ".");
            }
            if (iMissing > 0) {
                return "Check the PDF and fill in the " + iMissing + " field" + (iMissing > 1 ? "s" : "")
                    + " marked below before approving.";
            }
            return "Fields can be corrected while this case needs review or was returned.";
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
            // Keep the PDF iframe stable across pipeline polls for the same case.
            if (this._documentCaseId === oCase.id && this._documentBlobUrl) {
                return;
            }
            this._revokeDocument();
            this._documentCaseId = oCase.id;
            api.blob(this.casePath(oCase.id) + "/document")
                .then(function (oBlob) {
                    // The preview frame needs the real type: PDFs open in the PDF viewer, PNG/JPEG show as
                    // images. Only a file served without a usable type is treated as a PDF.
                    var bTyped = /^(application\/pdf|image\/)/i.test(oBlob.type || "");
                    var oDocument = bTyped ? oBlob : new Blob([oBlob], { type: "application/pdf" });
                    that._documentBlobUrl = URL.createObjectURL(oDocument);
                    that._model.setProperty("/selectedInvoice/documentIsImage", /^image\//i.test(oDocument.type));
                    that._model.setProperty("/selectedInvoice/documentUrl", that._documentBlobUrl);
                }).catch(function (oError) {
                    that._documentCaseId = null;
                    that._model.setProperty("/selectedInvoice/documentUrl", "");
                    MessageToast.show("Document unavailable: " + oError.message);
                });
        },

        _revokeDocument: function () {
            if (this._documentBlobUrl) {
                URL.revokeObjectURL(this._documentBlobUrl);
                this._documentBlobUrl = null;
            }
            this._documentCaseId = null;
        },

        // ---------------------------------------------------------- audit trail

        // oHistory: AP Core's audit trail, {items: [{event_type, actor, reason, payload, created_at}]}.
        _applyHistory: function (oHistory) {
            this._model.setProperty("/auditTrail", (oHistory.items || []).slice().reverse().map(function (oEvent) {
                var aTone = C.EVENT_TONES[oEvent.event_type] || ["info", "sap-icon://ai"];
                var sRole = (oEvent.payload || {}).role;
                return {
                    tone: aTone[0],
                    icon: aTone[1],
                    title: C.EVENT_TITLES[oEvent.event_type] || oEvent.event_type.replace(/_/g, " ").toLowerCase(),
                    description: this._eventDescription(oEvent),
                    meta: oEvent.actor + (sRole ? " (" + sRole + ")" : "") + " · " + this._formatDate(oEvent.created_at)
                };
            }, this));
        },

        _eventDescription: function (oEvent) {
            var oPayload = oEvent.payload || {};
            var aParts = oEvent.reason ? [oEvent.reason] : [];
            var sStatus = oPayload.to || oPayload.status;
            if (oEvent.event_type === "FIELDS_CORRECTED" && oPayload.after) {
                Object.keys(oPayload.after).forEach(function (sKey) {
                    var vBefore = (oPayload.before || {})[sKey];
                    aParts.push(sKey.replace(/_/g, " ") + ": " + (vBefore || "—") + " → " + (oPayload.after[sKey] || "—"));
                });
            } else if (sStatus) {
                aParts.push("Status: " + (C.STATUS_LABELS[sStatus] || sStatus));
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
            clearTimeout(this._casePollTimer);
            this._revokeDocument();
            this._model.destroy();
            BaseObject.prototype.destroy.apply(this, arguments);
        }
    });
});
