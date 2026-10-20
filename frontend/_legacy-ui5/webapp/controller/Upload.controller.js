sap.ui.define([
    "saudicargo/ap/automation/controller/BaseController",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "saudicargo/ap/automation/model/constants"
], function (BaseController, MessageToast, MessageBox, C) {
    "use strict";

    // After the file lands, stay on Upload and poll the case so Classify → Extract light up live,
    // then open Clear Desk (Review) where the full pipeline keeps updating while PROCESSING.
    return BaseController.extend("saudicargo.ap.automation.controller.Upload", {
        onInit: function () {
            this._resetSteps();
            this.getRouter().getRoute("upload").attachPatternMatched(this._onRouteMatched, this);
        },

        onExit: function () {
            this._stopWatch();
        },

        _onRouteMatched: function () {
            if (!this.getData().getProperty("/upload/watching")) {
                this._resetSteps();
            }
        },

        onAfterRendering: function () {
            this._attachDropZone();
        },

        onUploadChange: function (oEvent) {
            var oFile = (oEvent.getParameter("files") || [])[0];
            if (!oFile) {
                MessageToast.show("No file selected");
                return;
            }
            this._uploadInvoiceFile(oFile);
        },

        onOpenLiveCase: function () {
            var sCaseId = this.getData().getProperty("/upload/caseId");
            if (sCaseId) {
                this._goToReview(sCaseId);
            }
        },

        _uploadInvoiceFile: function (oFile) {
            var that = this;
            var oData = this.getData();
            var oFormData = new FormData();
            oFormData.append("file", oFile, oFile.name);

            this._stopWatch();
            this._resetSteps();
            oData.setProperty("/upload", {
                visible: true,
                message: "Receiving " + oFile.name + "…",
                state: "Information",
                fileName: oFile.name,
                watching: false,
                nowText: C.PIPELINE_NOW_LABELS.receive,
                progressPercent: 8,
                caseId: ""
            });
            oData.setProperty("/busy", true);
            that._setDropZoneBusy(true);
            that._setStepState("receive", "running");

            this.getCaseStore().call("POST", "/api/v1/cases/upload", oFormData).then(function (oResult) {
                var sCaseId = (oResult && (oResult.case_id || oResult.id)) || "";
                that._setStepState("receive", "done");
                that._setStepState("classify", "running");
                oData.setProperty("/upload/visible", true);
                oData.setProperty("/upload/message", "Agents are working — watch the pipeline.");
                oData.setProperty("/upload/state", "Information");
                oData.setProperty("/upload/watching", true);
                oData.setProperty("/upload/caseId", sCaseId);
                oData.setProperty("/upload/nowText", C.PIPELINE_NOW_LABELS.classify);
                oData.setProperty("/upload/progressPercent", 22);
                that._setDropZoneBusy(true);
                MessageToast.show(oFile.name + " received — watching Classify…");
                if (sCaseId) {
                    that._startWatch(sCaseId);
                } else {
                    // No case id in response — still show a short staged demo then leave.
                    that._startStagedFallback();
                }
            }).catch(function (oError) {
                oData.setProperty("/upload", {
                    visible: true,
                    message: "Upload failed",
                    state: "Error",
                    fileName: oFile.name,
                    watching: false,
                    nowText: "",
                    progressPercent: 0,
                    caseId: ""
                });
                that._setStepState("receive", "failed");
                MessageBox.error(oError.message);
                oData.setProperty("/busy", false);
                that._setDropZoneBusy(false);
            }).finally(function () {
                var oUploader = that.byId("fileUploader");
                if (oUploader) {
                    oUploader.clear();
                }
            });
        },

        _startWatch: function (sCaseId) {
            var that = this;
            var iStarted = Date.now();
            this._watchCaseId = sCaseId;
            this._watchStartedAt = iStarted;

            var fnTick = function () {
                if (that._watchCaseId !== sCaseId) {
                    return;
                }
                that.getCaseStore().call("GET", that.getCaseStore().casePath(sCaseId)).then(function (oCase) {
                    if (that._watchCaseId !== sCaseId) {
                        return;
                    }
                    var aSteps = that.getCaseStore().buildPipelineFromCase(oCase);
                    var oProgress = that.getCaseStore().pipelineProgress(aSteps);
                    that.getData().setProperty("/uploadSteps", aSteps);
                    that.getData().setProperty("/upload/nowText", oProgress.nowText);
                    that.getData().setProperty("/upload/progressPercent", oProgress.percent);

                    var iElapsed = Date.now() - iStarted;
                    var bPastAgents = C.PROCESSING_STATUSES.indexOf(oCase.status) < 0;
                    var oExtract = aSteps.filter(function (oStep) {
                        return oStep.key === "extract";
                    })[0];
                    var bSawExtract = oExtract && (oExtract.state === "running" || oExtract.state === "done");
                    var bMinDone = iElapsed >= C.UPLOAD_WATCH_MIN_MS;
                    var bMaxDone = iElapsed >= C.UPLOAD_WATCH_MAX_MS;

                    // Leave once the user has seen at least Classify → Extract motion, or agents finish,
                    // or we hit the max stay so Clear Desk can take over as the live hero.
                    if (bPastAgents || bMaxDone || (bMinDone && bSawExtract) || (bMinDone && oProgress.percent >= 45)) {
                        that._goToReview(sCaseId);
                        return;
                    }
                    that._watchTimer = setTimeout(fnTick, C.PIPELINE_POLL_MS);
                }).catch(function () {
                    if (that._watchCaseId === sCaseId) {
                        that._watchTimer = setTimeout(fnTick, C.PIPELINE_POLL_MS);
                    }
                });
            };

            this._watchTimer = setTimeout(fnTick, C.PIPELINE_POLL_MS);
        },

        // If upload returns no case id, animate the first steps locally then open the dashboard.
        _startStagedFallback: function () {
            var that = this;
            var iStarted = Date.now();
            this._watchCaseId = "__staged__";
            var aPlan = [
                { at: 400, key: "classify", state: "running" },
                { at: 1600, key: "classify", state: "done" },
                { at: 1700, key: "extract", state: "running" },
                { at: 3200, key: "extract", state: "done" },
                { at: 3300, key: "finance", state: "running" }
            ];
            aPlan.forEach(function (oItem) {
                setTimeout(function () {
                    if (that._watchCaseId !== "__staged__") {
                        return;
                    }
                    that._setStepState(oItem.key, oItem.state);
                    var aSteps = that.getData().getProperty("/uploadSteps") || [];
                    var oProgress = that.getCaseStore().pipelineProgress(aSteps);
                    that.getData().setProperty("/upload/nowText", oProgress.nowText);
                    that.getData().setProperty("/upload/progressPercent", oProgress.percent);
                }, oItem.at);
            });
            this._watchTimer = setTimeout(function () {
                if (that._watchCaseId !== "__staged__") {
                    return;
                }
                that._stopWatch();
                that.getData().setProperty("/busy", false);
                that._setDropZoneBusy(false);
                that.getData().setProperty("/upload/watching", false);
                MessageToast.show("Open the case from the dashboard to keep watching.");
                that.navTo("dashboard");
                that.getCaseStore().loadCases();
            }, Math.max(C.UPLOAD_WATCH_MIN_MS, 3800) - (Date.now() - iStarted));
        },

        _goToReview: function (sCaseId) {
            this._stopWatch();
            var oData = this.getData();
            oData.setProperty("/busy", false);
            this._setDropZoneBusy(false);
            oData.setProperty("/upload/watching", false);
            oData.setProperty("/upload/visible", false);
            this.getCaseStore().loadCases();
            this.navTo("review", { caseId: sCaseId });
        },

        _stopWatch: function () {
            clearTimeout(this._watchTimer);
            this._watchTimer = null;
            this._watchCaseId = null;
        },

        _resetSteps: function () {
            this._stopWatch();
            var oData = this.getData();
            oData.setProperty("/uploadSteps", C.PIPELINE_STEPS.map(function (oStep) {
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
            oData.setProperty("/upload/watching", false);
            oData.setProperty("/upload/nowText", "");
            oData.setProperty("/upload/progressPercent", 0);
            oData.setProperty("/upload/caseId", "");
        },

        _setStepState: function (sKey, sState) {
            var oData = this.getData();
            var aSteps = (oData.getProperty("/uploadSteps") || []).map(function (oStep) {
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
            oData.setProperty("/uploadSteps", aSteps);
        },

        _setDropZoneBusy: function (bBusy) {
            var oZone = this.byId("dropZone");
            if (!oZone) {
                return;
            }
            oZone.toggleStyleClass("apHeroDrop--busy", !!bBusy);
            oZone.toggleStyleClass("apHeroDrop--watching", !!this.getData().getProperty("/upload/watching"));
        },

        // Native HTML5 drag-and-drop onto the hero zone, feeding the same upload path as Browse.
        _attachDropZone: function () {
            var oZone = this.byId("dropZone");
            var oDom = oZone && oZone.getDomRef();
            // Watch mode unrenders the idle grid — re-bind when the drop zone returns to the DOM.
            if (!oDom) {
                this._dropZoneAttached = false;
                return;
            }
            if (this._dropZoneAttached) {
                return;
            }
            this._dropZoneAttached = true;
            var that = this;

            var fnOver = function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (!that.getData().getProperty("/busy") && !that.getData().getProperty("/upload/watching")) {
                    oZone.addStyleClass("apHeroDrop--dragover");
                }
            };
            var fnOut = function (e) {
                e.preventDefault();
                e.stopPropagation();
                oZone.removeStyleClass("apHeroDrop--dragover");
            };
            var fnDrop = function (e) {
                fnOut(e);
                var aFiles = (e.dataTransfer && e.dataTransfer.files) || [];
                if (aFiles.length && !that.getData().getProperty("/busy")
                    && !that.getData().getProperty("/upload/watching")) {
                    that._uploadInvoiceFile(aFiles[0]);
                }
            };

            ["dragenter", "dragover"].forEach(function (sType) {
                oDom.addEventListener(sType, fnOver);
            });
            oDom.addEventListener("dragleave", fnOut);
            oDom.addEventListener("drop", fnDrop);
        }
    });
});
