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
            this._uploadWatchTimer = null;
            this._uploadWatchCaseId = null;
            this._documentCaseId = null;
            this._processingIds = [];
            this._model = new JSONModel({
                section: "dashboard",
                currentUser: {},
                welcome: {},
                busy: false,
                kpiCards: [],
                deskLink: {
                    openText: "All invoices",
                    chipText: "",
                    attention: false
                },
                upload: {
                    visible: false,
                    message: "",
                    state: "None",
                    fileName: "",
                    watching: false,
                    nowText: "",
                    progressPercent: 0,
                    caseId: "",
                    result: "",
                    homeReview: false,
                    promptBrowse: false
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
                queueWarning: "",
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
                that._model.setProperty("/queueWarning", that._queueWarning(aCases));
                that._model.setProperty("/pipelineBannerDots", that._pipelineBannerDots(aCases));
                that._setDeskLink(aCases, aGroups);
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

        // Home “Open desk” CTA — total count + optional needs-review chip from the same list load.
        _setDeskLink: function (aCases, aGroups) {
            var oReview = (aGroups || []).filter(function (oGroup) {
                return oGroup.key === "review";
            })[0];
            var iReview = oReview ? oReview.count : 0;
            this._model.setProperty("/deskLink", {
                openText: "All invoices (" + aCases.length + ")",
                chipText: iReview === 1 ? "1 needs review" : iReview + " need review",
                attention: iReview > 0
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

        // Uploads wait in AP Core's queue until the worker picks them up; a long wait means it is stopped.
        _queuedTooLong: function (oCase) {
            return oCase.status === "RECEIVED" && Date.now() - Date.parse(oCase.created_at) > C.QUEUE_WARNING_MS;
        },

        _queueWarning: function (aCases) {
            var iWaiting = aCases.filter(this._queuedTooLong).length;
            if (!iWaiting) {
                return "";
            }
            return (iWaiting === 1 ? "1 invoice has" : iWaiting + " invoices have") + " been waiting more than "
                + C.QUEUE_WARNING_MS / 60000 + " minutes for processing to start. "
                + "The processing service (worker) may be stopped.";
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
            var oStates;
            if (sStatus === "RECEIVED") {
                oStates = { receive: "running" };
            } else if (sStatus === "PROCESSING") {
                oStates = { receive: "done", classify: "done", extract: "running" };
            } else if (sStatus === "PROCESSING_ERROR") {
                oStates = { receive: "done", classify: "failed" };
            } else {
                return [];
            }
            return C.PIPELINE_STEPS.map(function (oDef) {
                return {
                    key: oDef.key,
                    title: oDef.title,
                    short: oDef.title.split(" ")[0],
                    state: oStates[oDef.key] || "pending"
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
                // Pause off Review / Home-inline review; those screens restart via route or upload finish.
                var sSection = that._model.getProperty("/section");
                var bHomeInline = sSection === "dashboard" && that._model.getProperty("/upload/homeReview");
                if (sSection !== "review" && !bHomeInline) {
                    return;
                }
                that.loadCase(oCase.id);
            }, C.PIPELINE_POLL_MS);
        },

        // Shared mapper for Upload stay-and-watch and Review Agent Results.
        buildPipelineFromCase: function (oCase) {
            return this._mapPipelineSteps(oCase || {}, (oCase && oCase.validation) || {});
        },

        // After upload, Home shows the green process theater; poll here so it survives nav away from Upload.
        startUploadWatch: function (sCaseId) {
            var that = this;
            this.stopUploadWatch();
            if (!sCaseId) {
                return;
            }
            this._uploadWatchCaseId = sCaseId;
            this._model.setProperty("/upload/watching", true);
            this._model.setProperty("/upload/caseId", sCaseId);

            var fnTick = function () {
                if (that._uploadWatchCaseId !== sCaseId) {
                    return;
                }
                that.call("GET", that.casePath(sCaseId)).then(function (oCase) {
                    if (that._uploadWatchCaseId !== sCaseId) {
                        return;
                    }
                    var aSteps = that.buildPipelineFromCase(oCase);
                    var oProgress = that.pipelineProgress(aSteps);
                    that._model.setProperty("/uploadSteps", aSteps);
                    that._model.setProperty("/upload/nowText", oProgress.nowText);
                    that._model.setProperty("/upload/progressPercent", oProgress.percent);

                    if (C.PROCESSING_STATUSES.indexOf(oCase.status) < 0) {
                        var bReady = oCase.status === "READY_FOR_APPROVAL";
                        that.stopUploadWatch();
                        that._model.setProperty("/busy", false);
                        that._model.setProperty("/upload/watching", true);
                        that._model.setProperty("/upload/result", bReady ? "ready" : "review");
                        that._model.setProperty("/upload/homeReview", true);
                        that._model.setProperty("/upload/nowText", bReady
                            ? "Done: every detail matches SAP. The invoice now waits for an approver."
                            : "Done: the invoice needs a review before it can be approved.");
                        that._model.setProperty("/upload/message", "Processing finished.");
                        that.loadCases();
                        that.loadCase(sCaseId);
                        return;
                    }
                    that._uploadWatchTimer = setTimeout(fnTick, C.PIPELINE_POLL_MS);
                }).catch(function () {
                    if (that._uploadWatchCaseId === sCaseId) {
                        that._uploadWatchTimer = setTimeout(fnTick, C.PIPELINE_POLL_MS);
                    }
                });
            };

            this._uploadWatchTimer = setTimeout(fnTick, C.PIPELINE_POLL_MS);
        },

        stopUploadWatch: function () {
            clearTimeout(this._uploadWatchTimer);
            this._uploadWatchTimer = null;
            this._uploadWatchCaseId = null;
        },

        clearUploadTheater: function () {
            this.stopUploadWatch();
            this._model.setProperty("/upload/watching", false);
            this._model.setProperty("/upload/visible", false);
            this._model.setProperty("/upload/result", "");
            this._model.setProperty("/upload/homeReview", false);
            this._model.setProperty("/upload/nowText", "");
            this._model.setProperty("/upload/progressPercent", 0);
            this._model.setProperty("/upload/caseId", "");
            this._model.setProperty("/busy", false);
        },

        // Shared by Home and Upload: reset the green pipeline step rail.
        resetUploadSteps: function () {
            this._model.setProperty("/uploadSteps", C.PIPELINE_STEPS.map(function (oStep) {
                return {
                    key: oStep.key,
                    title: oStep.title,
                    service: oStep.service || "",
                    description: oStep.description,
                    nowLabel: "",
                    icon: oStep.icon,
                    state: "pending",
                    statusLabel: C.PIPELINE_STATUS_LABELS.pending
                };
            }));
        },

        setUploadStepState: function (sKey, sState) {
            var aSteps = (this._model.getProperty("/uploadSteps") || []).map(function (oStep) {
                if (oStep.key !== sKey) {
                    return oStep;
                }
                var sNow = sState === "running" ? (C.PIPELINE_NOW_LABELS[sKey] || "") : "";
                return Object.assign({}, oStep, {
                    state: sState,
                    statusLabel: C.PIPELINE_STATUS_LABELS[sState] || sState,
                    nowLabel: sNow,
                    description: sNow || oStep.description,
                    icon: sState === "done" ? "sap-icon://accept"
                        : sState === "failed" ? "sap-icon://error"
                            : sState === "running" ? "sap-icon://synchronize"
                                : oStep.icon
                });
            });
            this._model.setProperty("/uploadSteps", aSteps);
        },

        // Upload from Home or Upload screen. Sets watching=true and starts the poll;
        // theater stays until clearUploadTheater (Review / Dismiss). Does not navigate.
        uploadInvoiceFile: function (oFile) {
            var that = this;
            var oFormData = new FormData();
            oFormData.append("file", oFile, oFile.name);

            this.clearUploadTheater();
            this.resetUploadSteps();
            this._model.setProperty("/upload", {
                visible: true,
                message: "Receiving " + oFile.name + "…",
                state: "Information",
                fileName: oFile.name,
                watching: false,
                nowText: C.PIPELINE_NOW_LABELS.receive,
                progressPercent: 8,
                caseId: "",
                result: "",
                homeReview: false,
                promptBrowse: false
            });
            this._model.setProperty("/busy", true);
            this.setUploadStepState("receive", "running");

            return this.call("POST", "/api/v1/cases/upload", oFormData).then(function (oResult) {
                var sCaseId = (oResult && (oResult.case_id || oResult.id)) || "";
                if (oResult && oResult.duplicate) {
                    that._model.setProperty("/upload/visible", false);
                    that._model.setProperty("/busy", false);
                    return {
                        duplicate: true,
                        caseId: sCaseId,
                        status: oResult.status,
                        fileName: oFile.name
                    };
                }
                that.setUploadStepState("receive", "done");
                that.setUploadStepState("classify", "running");
                that._model.setProperty("/upload/visible", true);
                that._model.setProperty("/upload/message", "Agents are working — watch the pipeline here.");
                that._model.setProperty("/upload/state", "Information");
                that._model.setProperty("/upload/watching", true);
                that._model.setProperty("/upload/caseId", sCaseId);
                that._model.setProperty("/upload/nowText", C.PIPELINE_NOW_LABELS.classify);
                that._model.setProperty("/upload/progressPercent", 22);
                that._model.setProperty("/busy", false);
                if (sCaseId) {
                    that.startUploadWatch(sCaseId);
                    that.loadCases();
                }
                return {
                    duplicate: false,
                    caseId: sCaseId,
                    fileName: oFile.name
                };
            }).catch(function (oError) {
                that._model.setProperty("/upload", {
                    visible: true,
                    message: "Upload failed",
                    state: "Error",
                    fileName: oFile.name,
                    watching: false,
                    nowText: "",
                    progressPercent: 0,
                    caseId: "",
                    result: "",
                    homeReview: false,
                    promptBrowse: false
                });
                that.setUploadStepState("receive", "failed");
                that._model.setProperty("/busy", false);
                throw oError;
            });
        },

        pipelineProgress: function (aSteps) {
            // Steps that did not run (agents skipped, details entered by hand) are not part of the count.
            var aList = (aSteps || []).filter(function (oStep) {
                return oStep.state !== "skipped";
            });
            var iDone = aList.filter(function (oStep) {
                return oStep.state === "done" || (oStep.state === "failed" && oStep.agent === "SOURCE_CHECK");
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
                pipelineSteps: [],
                overview: { facts: [] },
                issues: [],
                agents: [],
                agentDetail: null,
                verdict: { points: [] },
                fieldsTitle: "",
                editing: false,
                fieldsGuidance: "",
                isProcessing: false,
                pipelineNow: "",
                pipelinePercent: 0,
                pipelineSummary: "",
                queueWarning: "",
                pipelineTitle: ""
            };
        },

        _mapCaseToSelectedInvoice: function (oCase) {
            var oValidation = oCase.validation || {};
            var oPermissions = this._model.getProperty("/permissions");
            var sStatus = oCase.status;
            var aFields = this._mapFields(oCase, oValidation);
            var aPipeline = this._mapPipelineSteps(oCase, oValidation);
            var oProgress = this.pipelineProgress(aPipeline);
            var bProcessing = C.PROCESSING_STATUSES.indexOf(sStatus) >= 0;
            var oIssues = this._mapIssues(oCase, oValidation);
            var aAgents = this._mapAgents(oCase, oValidation, aPipeline);
            // Keep the agent the user opened while the same case refreshes.
            var sAgentKey = this._model.getProperty("/selectedInvoice/caseId") === oCase.id
                ? this._model.getProperty("/selectedInvoice/agentDetail/key") : "";
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
                overview: this._mapOverview(oCase, oValidation, oIssues.count),
                issues: oIssues.rows,
                agents: aAgents,
                agentDetail: this._pickAgent(aAgents, sAgentKey),
                verdict: this._mapVerdict(oCase, oValidation, oIssues.rows),
                fieldsTitle: this._fieldsTitle(oValidation),
                pipelineSteps: aPipeline,
                isProcessing: bProcessing,
                pipelineNow: oProgress.nowText,
                queueWarning: this._queuedTooLong(oCase)
                    ? "Processing has not started after more than " + C.QUEUE_WARNING_MS / 60000
                        + " minutes. The processing service (worker) may be stopped."
                    : "",
                pipelinePercent: oProgress.percent,
                pipelineSummary: oProgress.doneCount + " of " + oProgress.total + " steps complete",
                pipelineTitle: "Processing steps · " + (bProcessing ? oProgress.nowText
                    : oProgress.doneCount + " of " + oProgress.total + " complete"),
                fields: aFields,
                fieldsGuidance: this._fieldsGuidance(sStatus, oPermissions.processor, aFields),
                fileName: oCase.file_name,
                documentUrl: sExistingUrl,
                documentIsImage: bExistingImage,
                canEdit: oPermissions.processor && C.EDITABLE_STATUSES.indexOf(sStatus) >= 0,
                // The Edit button switches the invoice values to inputs.
                editing: false,
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
            var bError = sStatus === "PROCESSING_ERROR";
            var bNeedsHuman = ["NEEDS_REVIEW", "RETURNED", "READY_FOR_APPROVAL", "PENDING_APPROVAL"].indexOf(sStatus) >= 0;
            // An invoice awaiting approval is the approver's turn, so everyone else sees it as waiting.
            var bAwaitingApproval = C.DECIDABLE_STATUSES.indexOf(sStatus) >= 0
                && !this._model.getProperty("/permissions/approver");
            var bApproved = ["APPROVED", "POSTING", "POSTED"].indexOf(sStatus) >= 0;
            var bRejected = sStatus === "REJECTED";
            var bPastAgents = bNeedsHuman || bApproved || bRejected || bError;
            // RECEIVED means queued for the worker; the agents only run once it is PROCESSING.
            var bQueued = sStatus === "RECEIVED";
            var bAgentsRunning = sStatus === "PROCESSING";
            var sRunningAgent = this._inferRunningAgent(aTrace, oByAgent, bAgentsRunning);
            // The SAP data check steps fill in from its checks: live while it runs, then from the verdict.
            var aSourceRows = (oValidation.source_verdict || {}).comparisons || oValidation.source_checks || [];
            var bSourceRunning = bAgentsRunning && sRunningAgent === "SOURCE_CHECK";
            var bSourceTurnTaken = false;

            return C.PIPELINE_STEPS.map(function (oDef) {
                var oTrace = oDef.agent ? oByAgent[oDef.agent] : null;
                var sState = "pending";
                var sDescription = oDef.description;
                var sResultLabel = "";
                var aChecks = [];

                if (oDef.key === "receive") {
                    sState = bQueued ? "running" : "done";
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
                        sState = "waiting";
                        sDescription = "Waiting for an approver to approve, return or reject on Dock Decide.";
                    } else if (bNeedsHuman) {
                        sState = "waiting";
                        sDescription = sStatus === "RETURNED"
                            ? "Returned for corrections on Clear Desk before Dock Decide."
                            : "Open Clear Desk to check fields, then use Dock Decide.";
                    } else if (bError) {
                        sState = "pending";
                        sDescription = "Fix extraction on Clear Desk, then send for approval.";
                    } else {
                        sState = "pending";
                    }
                } else if (oDef.sourceChecks) {
                    var aRows = aSourceRows.filter(function (oRow) {
                        return oDef.sourceChecks.indexOf(oRow.check) >= 0;
                    });
                    var aDiffs = aRows.filter(function (oRow) {
                        return C.SOURCE_DISCREPANCIES.indexOf(oRow.result) >= 0;
                    }).map(function (oRow) {
                        return oRow.message;
                    });
                    aChecks = this._sourceCheckSteps(aRows);
                    if (aRows.length) {
                        sState = aDiffs.length ? "failed" : "done";
                        sResultLabel = aDiffs.length ? "Differs" : "Matches";
                        sDescription = aDiffs.length ? aDiffs.join(" ") : "Matches the SAP data.";
                    } else if (oTrace || (bPastAgents && !bError)) {
                        sState = "skipped";
                        sResultLabel = oTrace ? "Not needed" : "";
                        sDescription = oTrace ? "Not needed for this invoice." : "Did not run for this invoice.";
                    } else if (bSourceRunning && !bSourceTurnTaken) {
                        sState = "running";
                        bSourceTurnTaken = true;
                    }
                } else if (oTrace) {
                    // The agent's own summary is technical; the step says in plain words what was done.
                    sState = this._traceToPipelineState(oTrace.status);
                    sDescription = sState === "failed" ? "This step could not be completed."
                        : C.STEP_DONE_TEXTS[oDef.key] || oDef.description;
                } else if (bPastAgents && !bError) {
                    // No per-step trace: AP Core's own checks always ran, the agents only if they delivered fields.
                    if (oDef.key === "finance" || (oValidation.agents_completed && !oDef.traceOnly)) {
                        sState = "done";
                    } else {
                        sState = "skipped";
                        sDescription = oValidation.agents_completed
                            ? "Did not run for this invoice."
                            : "Did not run — the invoice details were entered on Clear Desk.";
                    }
                } else if (bError) {
                    // An agent without a trace never ran; with no trace at all, processing stopped at the first one.
                    if (!aTrace.length && oDef.agent === "CLASSIFIER") {
                        sState = "failed";
                        sDescription = "Automatic processing stopped during classification or extraction.";
                    } else {
                        sState = "pending";
                    }
                } else if (bAgentsRunning && oDef.agent && oDef.agent === sRunningAgent) {
                    sState = "running";
                    sDescription = oDef.description;
                } else if (bAgentsRunning && oDef.agent && this._agentIndex(oDef.agent) < this._agentIndex(sRunningAgent)) {
                    sState = "done";
                }

                var sNowLabel = "";
                if (sState === "running") {
                    sNowLabel = C.PIPELINE_NOW_LABELS[oDef.key] || ("Working on " + oDef.title + "…");
                    // The decide step keeps its own text: who acts next (processor or approver).
                    if (oDef.key !== "decide") {
                        sDescription = sNowLabel;
                    }
                } else if (sState === "done" && oDef.key !== "receive" && oDef.key !== "decide" && !oTrace
                    && !oDef.sourceChecks) {
                    sDescription = oDef.description + " — complete.";
                }

                var sStatusLabel = sResultLabel || C.PIPELINE_STATUS_LABELS[sState] || sState;
                // Decide waits on a person, so it is shown as waiting (no spinner), not as working.
                if (sState === "waiting") {
                    sStatusLabel = bAwaitingApproval ? "Awaiting approval" : "Your turn";
                } else if (oDef.key === "receive" && sState === "running") {
                    sStatusLabel = "Queued";
                }

                return {
                    key: oDef.key,
                    agent: oDef.agent || "",
                    title: oDef.title,
                    service: oDef.service || "",
                    description: sDescription,
                    nowLabel: sNowLabel,
                    checks: aChecks,
                    state: sState,
                    statusLabel: sStatusLabel,
                    tone: sState === "done" ? "success"
                        : sState === "failed" ? "error"
                            : sState === "running" ? "info"
                                : sState === "waiting" ? "warning" : "muted",
                    icon: sState === "done" ? "sap-icon://accept"
                        : sState === "failed" ? "sap-icon://error"
                            : sState === "skipped" ? "sap-icon://less"
                                : sState === "running" ? "sap-icon://synchronize" : oDef.icon
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
            var i = C.AGENT_ORDER.indexOf(sAgent);
            return i < 0 ? C.AGENT_ORDER.length : i;
        },

        // Next agent that has not completed yet while the case is still PROCESSING/RECEIVED.
        _inferRunningAgent: function (aTrace, oByAgent, bProcessing) {
            if (!bProcessing) {
                return null;
            }
            var aOrder = C.AGENT_ORDER;
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
            return aOrder[aOrder.length - 1];
        },

        // ------------------------------------------------------- agent results

        // Headline, message and key facts at the top of Agent Results.
        _mapOverview: function (oCase, oValidation, iIssues) {
            var aOutcome = C.OUTCOMES[oCase.status]
                || ["None", "sap-icon://hint", C.STATUS_LABELS[oCase.status] || oCase.status, ""];
            var oClassification = oValidation.ai_core || {};
            var sType = (oCase.fields || {}).document_type || oClassification.document_type || "";
            var aType = C.DOCUMENT_TYPES[sType]
                || [sType ? sType.replace(/_/g, " ") : "Not recognised yet", "sap-icon://document"];
            var fConfidence = oClassification.confidence;
            var sText = aOutcome[3].indexOf("{0}") < 0 ? aOutcome[3]
                : iIssues ? aOutcome[3].replace("{0}", iIssues === 1 ? "1 issue" : iIssues + " issues")
                    : "Check the details on the Fields tab before approval.";
            return {
                state: aOutcome[0],
                icon: aOutcome[1],
                title: aOutcome[2],
                text: sText,
                documentType: aType[0],
                documentIcon: aType[1],
                facts: [
                    { label: "Invoice total", value: this._formatAmount(oCase) },
                    { label: "Purchase order", value: oCase.po_number || "—" },
                    { label: "Invoice date", value: oCase.invoice_date || "—" },
                    // As a percentage, coloured green (high), yellow (average) or red (low).
                    {
                        label: "Reading confidence",
                        value: typeof fConfidence === "number" ? Math.round(fConfidence * 100) + "%" : "—",
                        tone: typeof fConfidence !== "number" ? ""
                            : fConfidence >= 0.85 ? "high" : fConfidence >= 0.6 ? "average" : "low"
                    }
                ]
            };
        },

        // What to resolve, ordered by area and in plain words, from AP Core's checks and the SAP data check.
        _mapIssues: function (oCase, oValidation) {
            var aIssues = [];
            var fnAdd = function (sArea, sTitle, sDetail) {
                aIssues.push({ area: sArea, title: sTitle, detail: sDetail || "" });
            };
            var aBlocking = oValidation.blocking || [];
            if (oCase.status === "PROCESSING_ERROR") {
                fnAdd("Invoice details", "Automatic processing failed", "Enter the details on the Fields tab.");
            }
            if (oCase.status === "RETURNED" && oCase.review_reason) {
                fnAdd("Invoice details", "Returned by the approver", oCase.review_reason);
            }
            var aMissing = oValidation.missing_fields || [];
            if (aMissing.length) {
                fnAdd("Invoice details", "Details missing on the invoice", this._fieldLabels(aMissing));
            }
            if (aBlocking.indexOf("EXTRACTION_NOT_COMPLETED") >= 0) {
                fnAdd("Invoice details", "The invoice could not be fully read");
            } else if (aBlocking.indexOf("TRIAGE_REVIEW_REQUIRED") >= 0) {
                fnAdd("Invoice details", "Some details were read with low confidence");
            }
            if (oValidation.business_duplicate) {
                fnAdd("Invoice details", "Possible duplicate invoice",
                    "Another invoice has the same number, supplier and company code.");
            }
            if (aBlocking.some(function (sCode) {
                return sCode.indexOf("AMOUNT_") === 0;
            })) {
                fnAdd("Amounts & dates", "The amount is not a valid number");
            }
            var oVerdict = oValidation.source_verdict || {};
            (oVerdict.comparisons || []).forEach(function (oRow) {
                var aIssue = C.SOURCE_ISSUES[oRow.check];
                if (aIssue && C.SOURCE_DISCREPANCIES.indexOf(oRow.result) >= 0) {
                    fnAdd(aIssue[0], aIssue[1], [
                        oRow.sap && "SAP " + aIssue[2] + ": " + oRow.sap,
                        oRow.invoice && "Invoice " + aIssue[2] + ": " + oRow.invoice
                    ].filter(Boolean).join(" · "));
                }
            });
            if (oVerdict.status === "NOT_FOUND" && !oCase.po_number) {
                fnAdd("Purchase order", "No purchase order number on the invoice", "Add it on the Fields tab.");
            }
            // One compact row per issue, ordered by area; the area label is shown only on its first row.
            var aRows = [];
            C.ISSUE_AREAS.forEach(function (sArea) {
                aIssues.filter(function (oIssue) {
                    return oIssue.area === sArea;
                }).forEach(function (oIssue, iIndex) {
                    aRows.push({ area: iIndex ? "" : sArea, group: sArea, title: oIssue.title, detail: oIssue.detail });
                });
            });
            return { count: aRows.length, rows: aRows };
        },


        // One row per agent: what it does, its result in plain words and its status (live while processing).
        _mapAgents: function (oCase, oValidation, aPipeline) {
            var oByAgent = {};
            (oValidation.agent_trace || []).forEach(function (oStep) {
                oByAgent[oStep.agent] = oStep;
            });
            return C.AGENT_ORDER.map(function (sAgent) {
                var oTrace = oByAgent[sAgent];
                var aStates = aPipeline.filter(function (oStep) {
                    return oStep.agent === sAgent;
                }).map(function (oStep) {
                    return oStep.state;
                });
                var oResult = null;
                var sStatus = "pending";
                if (aStates.indexOf("running") >= 0) {
                    sStatus = "running";
                } else if (oTrace && oTrace.status === "failed") {
                    sStatus = "failed";
                } else if (oTrace || aStates.indexOf("done") >= 0) {
                    oResult = this._agentResult(sAgent, oCase, oValidation, oTrace);
                    sStatus = oResult.passed ? "passed" : "check";
                } else if (aStates.length && aStates.every(function (sState) {
                    return sState === "skipped";
                })) {
                    sStatus = "skipped";
                }
                var aStatus = C.AGENT_STATUSES[sStatus];
                return {
                    key: sAgent,
                    agent: sAgent.replace(/_/g, " "),
                    task: C.AGENT_TASKS[sAgent],
                    icon: C.AGENT_ICONS[sAgent],
                    result: oResult ? oResult.headline : aStatus[2],
                    detail: oResult ? oResult.detail : "",
                    points: oResult ? oResult.points : [],
                    // The SAP data check links to the Fields tab.
                    showComparison: !!oResult && sAgent === "SOURCE_CHECK",
                    statusKey: sStatus,
                    status: aStatus[0],
                    state: aStatus[1],
                    statusIcon: aStatus[3],
                    selected: false
                };
            }, this);
        },

        // Marks the agent shown below the stepper and returns it: the given one, else the first that needs a look.
        _pickAgent: function (aAgents, sKey) {
            var oPick = aAgents.filter(function (oAgent) {
                return oAgent.key === sKey;
            })[0] || aAgents.filter(function (oAgent) {
                return ["check", "failed", "running"].indexOf(oAgent.statusKey) >= 0;
            })[0] || aAgents[0] || null;
            aAgents.forEach(function (oAgent) {
                oAgent.selected = oAgent === oPick;
            });
            return oPick;
        },

        // A click on the stepper: show that agent's details.
        selectAgent: function (sKey) {
            var aAgents = this._model.getProperty("/selectedInvoice/agents");
            var oPick = this._pickAgent(aAgents, sKey);
            this._model.setProperty("/selectedInvoice/agents", aAgents);
            this._model.setProperty("/selectedInvoice/agentDetail", oPick);
        },

        // An agent's outcome in plain words: {headline, detail, passed, points}; points are the facts shown
        // when the row is opened, as [{label, value}].
        _agentResult: function (sAgent, oCase, oValidation, oTrace) {
            var aBlocking = oValidation.blocking || [];
            var fnResult = function (sHeadline, sDetail, bPassed, aPoints) {
                return {
                    headline: sHeadline,
                    detail: sDetail,
                    passed: bPassed,
                    points: aPoints.filter(function (aPoint) {
                        return aPoint[1];
                    }).map(function (aPoint) {
                        return { label: aPoint[0], value: aPoint[1] };
                    })
                };
            };
            var fnList = function (aItems) {
                return aItems.length ? aItems.join(", ") : "None";
            };
            if (sAgent === "CLASSIFIER") {
                var oClassification = oValidation.ai_core || {};
                var aType = C.DOCUMENT_TYPES[oClassification.document_type];
                var iPages = oClassification._total_pages;
                var aClassifierPoints = [
                    ["Document type", aType ? aType[0] : "Not recognised"],
                    ["Certainty", typeof oClassification.confidence === "number"
                        && Math.round(oClassification.confidence * 100) + "%"],
                    ["Pages checked", iPages && String(iPages)],
                    ["Note", oClassification.mixed_document_packet && "The file contains more than one type of document."]
                ];
                return aType
                    ? fnResult("Recognised as: " + aType[0], "The document was identified before its details were read.",
                        ["invoice", "credit_note"].indexOf(oClassification.document_type) >= 0, aClassifierPoints)
                    : fnResult("Document type not recognised", "Check the file is an invoice or a credit note.", false,
                        aClassifierPoints);
            }
            if (sAgent === "SCANNER") {
                var oFields = oCase.fields || {};
                // e.g. "Low confidence on required fields: currency, total_amount"
                var aLowMatch = /low confidence[^:]*:\s*(.+)$/i.exec(oValidation.triage_review_reason || "");
                var aLow = aBlocking.indexOf("TRIAGE_REVIEW_REQUIRED") >= 0 && aLowMatch ? aLowMatch[1].split(/\s*,\s*/) : [];
                var aFieldPoints = C.FIELDS.map(function (oField) {
                    var sValue = String(oFields[oField.key] || "").trim();
                    if (sValue && oField.key === "total_amount") {
                        sValue = this._formatAmount(oCase);
                    }
                    return [oField.label.replace(/\s*\(.*\)$/, ""),
                        (sValue || "Not found") + (aLow.indexOf(oField.key) >= 0 ? " · low confidence, check the PDF" : "")];
                }, this);
                if (aBlocking.indexOf("EXTRACTION_NOT_COMPLETED") >= 0) {
                    return fnResult("Could not read the whole invoice", "Check the missing details against the PDF.", false,
                        aFieldPoints);
                }
                if (aBlocking.indexOf("TRIAGE_REVIEW_REQUIRED") >= 0) {
                    return fnResult(aLow.length ? "Invoice read · low confidence on " + this._fieldLabels(aLow)
                        : "Invoice read · some details need a check", "Compare the flagged details with the PDF.", false,
                    aFieldPoints);
                }
                return fnResult("All invoice details read", "These are the details read from the invoice.", true,
                    aFieldPoints);
            }
            if (sAgent === "FINANCE_RULES") {
                var aMissing = oValidation.missing_fields || ((oTrace || {}).details || {}).missing_fields || [];
                var oDuplicate = oValidation.business_duplicate;
                var bAmountInvalid = aBlocking.some(function (sCode) {
                    return sCode.indexOf("AMOUNT_") === 0;
                });
                var aRulePoints = [
                    ["Required details", aMissing.length ? "Missing: " + this._fieldLabels(aMissing) : "All present"],
                    ["Duplicate check", oDuplicate
                        ? "Another invoice has the same number from this supplier ("
                            + (C.STATUS_LABELS[oDuplicate.matched_case_status] || oDuplicate.matched_case_status) + ")"
                        : "No other invoice with the same number from this supplier"],
                    ["Amount", bAmountInvalid ? "Not a valid number" : "Valid"]
                ];
                var aProblems = [
                    aMissing.length && "Missing: " + this._fieldLabels(aMissing),
                    oDuplicate && "Possible duplicate invoice",
                    bAmountInvalid && "The amount is not a valid number"
                ].filter(Boolean);
                return aProblems.length
                    ? fnResult(aProblems.join(" · "), "Fix these on the Fields tab before the invoice can be approved.", false,
                        aRulePoints)
                    : fnResult("All required details present · no duplicate found",
                        "The basic checks every invoice needs before approval.", true, aRulePoints);
            }
            if (sAgent === "VERIFIER") {
                var oMatch = oValidation.verifier_matching || oValidation.matching || {};
                var aReasons = (oMatch.reason_codes || []).map(function (sCode) {
                    return C.PO_MATCH_REASONS[sCode] || sCode.replace(/_/g, " ").toLowerCase();
                });
                var aNotShown = oMatch.missing_evidence || [];
                var fnLabels = function (bNotShown) {
                    return Object.keys(C.PO_MATCH_EVIDENCE).filter(function (sKey) {
                        return (aNotShown.indexOf(sKey) >= 0) === bNotShown;
                    }).map(function (sKey) {
                        return C.PO_MATCH_EVIDENCE[sKey];
                    });
                };
                var sPo = oMatch.po_number ? " " + oMatch.po_number : "";
                var aMatchPoints = [
                    ["Purchase order", oMatch.po_number || "Not on the invoice"],
                    ["Compared", fnList(fnLabels(false))],
                    ["Differences", fnList(aReasons)],
                    ["Not compared", fnLabels(true).length && fnLabels(true).join(", ") + " (not shown on the invoice)"]
                ];
                var sMatchDetail = "The invoice was checked against the purchase order it refers to.";
                if (oMatch.match_status === "PASS") {
                    return fnResult("Matches purchase order" + sPo, sMatchDetail, true, aMatchPoints);
                }
                if (oMatch.match_status === "FAIL") {
                    return fnResult("Differs from purchase order" + sPo + (aReasons.length ? ": " + aReasons.join(", ") : ""),
                        sMatchDetail, false, aMatchPoints);
                }
                return fnResult("Match not confirmed" + (aReasons.length ? ": " + aReasons.join(", ") : ""), sMatchDetail,
                    false, aMatchPoints);
            }
            if (sAgent === "SOURCE_CHECK") {
                var oVerdict = oValidation.source_verdict || {};
                var aRows = oVerdict.comparisons || [];
                var fnLabelsWhere = function (fnTest) {
                    return aRows.filter(fnTest).map(function (oRow) {
                        return oRow.label;
                    });
                };
                var aDiffers = fnLabelsWhere(function (oRow) {
                    return C.SOURCE_DISCREPANCIES.indexOf(oRow.result) >= 0;
                });
                var aMatches = fnLabelsWhere(function (oRow) {
                    return oRow.result === "MATCH";
                });
                var aNotCompared = fnLabelsWhere(function (oRow) {
                    return oRow.result !== "MATCH" && C.SOURCE_DISCREPANCIES.indexOf(oRow.result) < 0;
                });
                var aHeadline = {
                    MATCH: ["All " + aRows.length + " checks match SAP", true],
                    MISMATCH: [aDiffers.length + " of " + aRows.length + " checks differ from SAP", false],
                    NOT_FOUND: ["Purchase order not found in SAP", false],
                    INCOMPLETE: ["Some data is missing in SAP", false]
                }[oVerdict.status] || ["The SAP data check could not be completed", false];
                return fnResult(aHeadline[0], aRows.length
                    ? aMatches.length + " match · " + aDiffers.length + " differ · " + aNotCompared.length + " not compared."
                    : "", aHeadline[1], [
                    ["Purchase order", oVerdict.po_number || oCase.po_number],
                    ["Matches SAP", fnList(aMatches)],
                    ["Differs from SAP", fnList(aDiffers)],
                    ["Not compared", aNotCompared.join(", ")]
                ]);
            }
            // RECONCILER: the overall recommendation.
            var oInvestigation = oValidation.investigation || {};
            var aFindings = (oInvestigation.findings || []).map(function (oFinding) {
                return oFinding.code === "MISSING_FIELD" ? "Missing " + this._fieldLabels([oFinding.field]).toLowerCase()
                    : C.RECONCILER_FINDINGS[oFinding.code] || oFinding.code.replace(/_/g, " ").toLowerCase();
            }, this);
            if (oInvestigation.status === "CLEAR") {
                return fnResult("No concerns found", "Every check passed, so nothing needs a closer look.", true,
                    [["Recommendation", "No further checks needed"]]);
            }
            return fnResult("Recommends a manual review", aFindings.length
                ? aFindings.length + (aFindings.length === 1 ? " finding" : " findings") + " to look at before approval."
                : "Not enough evidence to confirm the invoice on its own.", false,
            [["Recommendation", "Review the invoice manually before approval"]].concat(aFindings.map(function (sFinding, iIndex) {
                return ["Finding " + (iIndex + 1), sFinding.charAt(0).toUpperCase() + sFinding.slice(1)];
            })));
        },

        // The verdict on the Summary tab: a headline (can this invoice be paid?) and a few pointers on why,
        // the main concerns and what to do next.
        _mapVerdict: function (oCase, oValidation, aIssues) {
            var sStatus = oCase.status;
            var oVerdict = oValidation.source_verdict || {};
            var aRows = oVerdict.comparisons || [];
            var sPo = oVerdict.po_number || oCase.po_number;
            var sPoText = sPo ? "purchase order " + sPo : "the purchase order";
            var bProcessing = C.PROCESSING_STATUSES.indexOf(sStatus) >= 0;
            var iMatches = aRows.filter(function (oRow) {
                return oRow.result === "MATCH";
            }).length;
            // Problems in SAP itself (blocked supplier, missing goods receipt, ...) can't be fixed on the invoice.
            var bSapSide = aRows.some(function (oRow) {
                return C.SAP_SIDE_CHECKS.indexOf(oRow.check) >= 0 && C.SOURCE_DISCREPANCIES.indexOf(oRow.result) >= 0;
            });
            var aHeadline = C.VERDICT_HEADLINES[sStatus] || [C.STATUS_LABELS[sStatus] || sStatus, "sap-icon://hint"];

            var sReason = bProcessing ? "The invoice is being read and checked against SAP."
                : sStatus === "PROCESSING_ERROR" ? "The invoice could not be read automatically."
                    : {
                        MATCH: "Every detail matches " + sPoText + " in SAP.",
                        MISMATCH: "The invoice doesn't match " + sPoText + " in SAP.",
                        NOT_FOUND: (sPo ? "Purchase order " + sPo : "The purchase order") + " could not be found in SAP.",
                        INCOMPLETE: "Some of the data needed to check the invoice is missing in SAP."
                    }[oVerdict.status] || "The invoice has not been checked against SAP.";

            var iIssues = aIssues.length;
            var sFix = "Correct the details on the Fields tab, or reject the invoice if it cannot be fixed.";
            var sNext = {
                NEEDS_REVIEW: !iIssues ? "Check the details on the Fields tab and send the invoice for approval."
                    : bSapSide ? "Some problems are in SAP itself, such as the supplier or purchase order, and must be "
                        + "fixed by the purchasing team first. " + sFix
                        : sFix,
                RETURNED: (oCase.review_reason ? "The approver's comment: " + oCase.review_reason + ". " : "")
                    + "Correct the details on the Fields tab and send the invoice again.",
                READY_FOR_APPROVAL: "An approver can approve the invoice for payment.",
                PENDING_APPROVAL: "An approver can approve the invoice for payment.",
                APPROVED: "No action needed. Posting to SAP is not enabled yet.",
                POSTING: "No action needed. The invoice is being posted to SAP.",
                POSTED: "No action needed.",
                REJECTED: oCase.review_reason ? "Reason given: " + oCase.review_reason : "No action needed.",
                PROCESSING_ERROR: "Enter the invoice details on the Fields tab using the PDF, then save to run the checks again."
            }[sStatus] || "Nothing to do yet. This page updates by itself when the checks finish.";

            // The SAP problems come before the reading ones, e.g. "supplier blocked in SAP" before "low confidence".
            var aConcerns = aIssues.filter(function (oIssue) {
                return oIssue.group !== "Invoice details";
            }).concat(aIssues.filter(function (oIssue) {
                return oIssue.group === "Invoice details";
            })).slice(0, 3).map(function (oIssue) {
                // Lower-case the first letter, but keep abbreviations such as "GL account".
                return /^[A-Z][a-z]/.test(oIssue.title) ? oIssue.title.charAt(0).toLowerCase() + oIssue.title.slice(1)
                    : oIssue.title;
            });
            return {
                headline: aHeadline[0],
                icon: aHeadline[1],
                points: [
                    sReason,
                    aRows.length && iMatches + " of " + aRows.length + " SAP checks passed"
                        + (iIssues ? ", and " + iIssues + (iIssues === 1 ? " issue needs" : " issues need") + " to be resolved."
                            : "."),
                    aConcerns.length && "Main concerns: " + aConcerns.join(", ")
                        + (iIssues > aConcerns.length ? " and " + (iIssues - aConcerns.length) + " more (listed below)." : "."),
                    "Next step: " + sNext
                ].filter(Boolean).map(function (sText) {
                    return { text: sText };
                })
            };
        },

        // Field keys as their labels on the Fields tab, e.g. "currency, total_amount" → "Currency, Total amount".
        _fieldLabels: function (aKeys) {
            return aKeys.map(function (sKey) {
                var oField = C.FIELDS.filter(function (oItem) {
                    return oItem.key === sKey;
                })[0];
                return oField ? oField.label : sKey.replace(/_/g, " ");
            }).join(", ");
        },

        // One SAP data check step's checks, e.g. "Fetching the supplier → Found".
        _sourceCheckSteps: function (aRows) {
            return aRows.map(function (oRow) {
                var aStep = C.SOURCE_CHECK_STEPS[oRow.check] || [oRow.label, false];
                var oResult = C.SOURCE_RESULTS[oRow.result] || { label: oRow.result, state: "None" };
                return {
                    text: aStep[0],
                    result: oRow.result === "MATCH" && aStep[1] ? "Found" : oResult.label,
                    state: oResult.state
                };
            });
        },

        // Plain-language guidance above the fields table — most specific for a failed extraction,
        // otherwise just points at whatever is still marked as needing attention.
        // e.g. "Compared with purchase order 4500012701 in SAP · 0 of 11 match".
        _fieldsTitle: function (oValidation) {
            var oVerdict = oValidation.source_verdict || {};
            var aRows = oVerdict.comparisons || [];
            if (!aRows.length) {
                return "Invoice details · not compared with SAP yet";
            }
            var iMatches = aRows.filter(function (oRow) {
                return oRow.result === "MATCH";
            }).length;
            return "Compared with " + (oVerdict.po_number ? "purchase order " + oVerdict.po_number + " in " : "") + "SAP · "
                + iMatches + " of " + aRows.length + " match";
        },

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
            return "";
        },

        // Fields tab: each invoice field with its SAP value and result, then the checks only SAP has
        // (supplier status, bank, net amount, goods receipt, accounts). Only the invoice fields can be edited.
        _mapFields: function (oCase, oValidation) {
            var aMissing = oValidation.missing_fields || [];
            var aComparisons = (oValidation.source_verdict || {}).comparisons || [];
            var fnSap = function (oRow) {
                var oResult = C.SOURCE_RESULTS[oRow.result] || { label: oRow.result, state: "None", icon: "sap-icon://less" };
                return {
                    sap: oRow.sap || "—",
                    result: oResult.label,
                    state: oResult.state,
                    icon: oResult.icon,
                    differs: C.SOURCE_DISCREPANCIES.indexOf(oRow.result) >= 0
                };
            };
            var aRows = C.FIELDS.map(function (oField) {
                var sValue = oCase[oField.key] == null ? "" : String(oCase[oField.key]);
                var oCompared = aComparisons.filter(function (oRow) {
                    return C.FIELD_CHECKS[oRow.check] === oField.key;
                })[0];
                // A format hint in the label, e.g. "Invoice Date (YYYY-MM-DD)", becomes the input's placeholder.
                var aHint = /^(.*?)\s*\((.*)\)$/.exec(oField.label);
                return Object.assign({
                    key: oField.key,
                    field: aHint ? aHint[1] : oField.label,
                    placeholder: aHint ? aHint[2] : "",
                    value: sValue,
                    original: sValue,
                    // Shown outside Edit, e.g. the total as "33,120.00 SAR".
                    display: sValue && oField.key === "total_amount" ? this._formatAmount(oCase) : sValue || "—",
                    editable: true,
                    needsAttention: (oField.required && !sValue) || aMissing.indexOf(oField.key) >= 0,
                    sap: "—", result: "", state: "None", icon: "", differs: false
                }, oCompared ? fnSap(oCompared) : {});
            }, this);
            aComparisons.filter(function (oRow) {
                return !C.FIELD_CHECKS[oRow.check];
            }).forEach(function (oRow) {
                aRows.push(Object.assign({
                    key: "",
                    field: oRow.label,
                    display: oRow.invoice || "—",
                    editable: false,
                    needsAttention: false
                }, fnSap(oRow)));
            });
            return aRows;
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
