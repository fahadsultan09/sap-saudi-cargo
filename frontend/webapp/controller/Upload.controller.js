sap.ui.define([
    "saudicargo/ap/automation/controller/BaseController",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "saudicargo/ap/automation/model/constants"
], function (BaseController, MessageToast, MessageBox, C) {
    "use strict";

    // Upload screen still works; after receive we hand off to Home where the green theater stays
    // until Review / Dismiss. CaseStore owns the poll so it survives this navigation.
    return BaseController.extend("saudicargo.ap.automation.controller.Upload", {
        onInit: function () {
            if (!this.getData().getProperty("/upload/watching")) {
                this.getCaseStore().resetUploadSteps();
            }
            this.getRouter().getRoute("upload").attachPatternMatched(this._onRouteMatched, this);
        },

        onExit: function () {
            clearTimeout(this._watchTimer);
            this._watchTimer = null;
        },

        _onRouteMatched: function () {
            // Only AP processors upload; anyone else reaching #/upload by address goes to the dashboard.
            if (!this.getData().getProperty("/permissions/processor")) {
                this.getRouter().navTo("dashboard", {}, true);
                return;
            }
            // Home owns the live theater; reset idle Upload UI when returning here.
            if (!this.getData().getProperty("/upload/watching")) {
                this.getCaseStore().resetUploadSteps();
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

        // Hand off to Home: keep the green theater and open the review under it.
        onReviewInvoice: function () {
            var sCaseId = this.getData().getProperty("/upload/caseId");
            this.getData().setProperty("/upload/homeReview", true);
            if (sCaseId) {
                this.getCaseStore().loadCase(sCaseId);
            }
            this.navTo("dashboard");
        },

        onGoToDashboard: function () {
            this.getCaseStore().clearUploadTheater();
            this.getCaseStore().loadCases();
            this.navTo("dashboard");
        },

        _uploadInvoiceFile: function (oFile) {
            var that = this;
            that._setDropZoneBusy(true);

            this.getCaseStore().uploadInvoiceFile(oFile).then(function (oOutcome) {
                that._setDropZoneBusy(false);
                if (oOutcome.duplicate) {
                    MessageBox.information(
                        "“" + oOutcome.fileName + "” was already uploaded, so it is not processed again. "
                        + "Open the existing invoice (status: "
                        + (C.STATUS_LABELS[oOutcome.status] || oOutcome.status)
                        + ") or upload another file.",
                        {
                            title: "Already uploaded",
                            actions: ["Open existing invoice", "Upload another"],
                            emphasizedAction: "Open existing invoice",
                            onClose: function (sAction) {
                                if (sAction === "Upload another") {
                                    that._openHomeUploadPicker();
                                    return;
                                }
                                if (sAction === "Open existing invoice") {
                                    that._goToReview(oOutcome.caseId);
                                }
                            }
                        }
                    );
                    return;
                }
                // Hand off to Home; theater stays there until Review / Dismiss.
                if (oOutcome.caseId) {
                    MessageToast.show(oOutcome.fileName + " received — opening Home pipeline…");
                    that.navTo("dashboard");
                } else {
                    that._startStagedFallback();
                }
            }).catch(function (oError) {
                that._setDropZoneBusy(false);
                MessageBox.error(oError.message);
            }).finally(function () {
                var oUploader = that.byId("fileUploader");
                if (oUploader) {
                    oUploader.clear();
                }
            });
        },

        // If upload returns no case id, animate steps on Home then leave the theater open.
        _startStagedFallback: function () {
            var that = this;
            var iStarted = Date.now();
            this._watchCaseId = "__staged__";
            this.getData().setProperty("/upload/watching", true);
            this.navTo("dashboard");
            this.getCaseStore().loadCases();
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
                    that.getCaseStore().setUploadStepState(oItem.key, oItem.state);
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
                that._watchCaseId = null;
                that.getData().setProperty("/busy", false);
                that.getData().setProperty("/upload/result", "review");
                that.getData().setProperty("/upload/nowText", "Open the case from the list to keep watching.");
                that.getData().setProperty("/upload/message", "Processing finished.");
                MessageToast.show("Open the case from the dashboard to keep watching.");
                that.getCaseStore().loadCases();
            }, Math.max(C.UPLOAD_WATCH_MIN_MS, 3800) - (Date.now() - iStarted));
        },

        _goToReview: function (sCaseId) {
            this.getCaseStore().clearUploadTheater();
            clearTimeout(this._watchTimer);
            this._watchTimer = null;
            this._watchCaseId = null;
            this._setDropZoneBusy(false);
            this.getCaseStore().loadCases();
            this.navTo("review", { caseId: sCaseId });
        },

        // Home owns intake; ask Dashboard to open its file picker after we land there.
        _openHomeUploadPicker: function () {
            this.getData().setProperty("/upload/promptBrowse", true);
            this.navTo("dashboard");
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
