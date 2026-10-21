sap.ui.define([
    "saudicargo/ap/automation/controller/BaseController",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "saudicargo/ap/automation/model/constants"
], function (BaseController, MessageToast, MessageBox, C) {
    "use strict";

    // Home: upload here, then keep the green process theater until Review or Dismiss.
    return BaseController.extend("saudicargo.ap.automation.controller.Dashboard", {
        onInit: function () {
            var oRouter = this.getRouter();
            oRouter.getRoute("home").attachPatternMatched(this._onHomeRouteMatched, this);
            oRouter.getRoute("dashboard").attachPatternMatched(this._onHomeRouteMatched, this);
        },

        onAfterRendering: function () {
            this._attachHomeDropZone();
            this._consumePromptBrowse();
        },

        _onHomeRouteMatched: function () {
            this._consumePromptBrowse();
        },

        // Upload screen (or a prior dialog) asked Home to open Browse for a new file.
        _consumePromptBrowse: function () {
            if (!this.getData().getProperty("/upload/promptBrowse")) {
                return;
            }
            var that = this;
            setTimeout(function () {
                if (!that.getData().getProperty("/upload/promptBrowse")) {
                    return;
                }
                that.getData().setProperty("/upload/promptBrowse", false);
                that.onGoUpload();
            }, 0);
        },

        onGoDesk: function () {
            this.navTo("desk");
        },

        // Open the Home file picker when idle; otherwise fall back to the Upload screen.
        onGoUpload: function () {
            if (this.getData().getProperty("/upload/watching") || this.getData().getProperty("/busy")) {
                MessageToast.show("Finish or dismiss the current pipeline first.");
                return;
            }
            var oUploader = this.byId("homeFileUploader");
            var oDom = oUploader && oUploader.getDomRef();
            var oInput = oDom && oDom.querySelector("input[type='file']");
            if (oInput) {
                oInput.click();
                return;
            }
            this.navTo("upload");
        },

        onGoQueue: function () {
            this.navTo("approvals");
        },

        onHomeUploadChange: function (oEvent) {
            var oFile = (oEvent.getParameter("files") || [])[0];
            if (!oFile) {
                MessageToast.show("No file selected");
                return;
            }
            this._uploadFromHome(oFile);
        },

        // Reveal / scroll to the inline Clear Desk panel under the green theater (stay on Home).
        onReviewHomePipeline: function () {
            var that = this;
            var sCaseId = this.getData().getProperty("/upload/caseId");
            this.getData().setProperty("/upload/homeReview", true);
            var fnScroll = function () {
                var oAnchor = that.byId("homeReviewAnchor");
                var oDom = oAnchor && oAnchor.getDomRef();
                if (oDom && oDom.scrollIntoView) {
                    oDom.scrollIntoView({ behavior: "smooth", block: "start" });
                }
            };
            if (sCaseId) {
                this.getCaseStore().loadCase(sCaseId).then(fnScroll).catch(fnScroll);
            } else {
                setTimeout(fnScroll, 0);
            }
        },

        onDismissHomePipeline: function () {
            this.getCaseStore().clearUploadTheater();
            this.getCaseStore().loadCases();
        },

        _uploadFromHome: function (oFile) {
            var that = this;
            this._setHomeDropBusy(true);
            this.getCaseStore().uploadInvoiceFile(oFile).then(function (oOutcome) {
                that._setHomeDropBusy(false);
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
                                    that.onGoUpload();
                                    return;
                                }
                                if (sAction === "Open existing invoice" && oOutcome.caseId) {
                                    that.getData().setProperty("/upload/result", "review");
                                    that.getData().setProperty("/upload/caseId", oOutcome.caseId);
                                    that.getData().setProperty("/upload/homeReview", true);
                                    that.getCaseStore().loadCase(oOutcome.caseId).then(function () {
                                        that.onReviewHomePipeline();
                                    });
                                }
                            }
                        }
                    );
                    return;
                }
                // Stay on Home — green theater stays until Review / Dismiss.
                MessageToast.show(oOutcome.fileName + " received — watching pipeline…");
                if (!oOutcome.caseId) {
                    that.getData().setProperty("/upload/result", "review");
                    that.getData().setProperty("/upload/nowText", "Open the case from Desk to keep watching.");
                }
            }).catch(function (oError) {
                that._setHomeDropBusy(false);
                MessageBox.error(oError.message);
            }).finally(function () {
                var oUploader = that.byId("homeFileUploader");
                if (oUploader) {
                    oUploader.clear();
                }
            });
        },

        _setHomeDropBusy: function (bBusy) {
            var oZone = this.byId("homeDropZone");
            if (!oZone) {
                return;
            }
            oZone.toggleStyleClass("apHeroDrop--busy", !!bBusy);
            oZone.toggleStyleClass("apHeroDrop--watching", !!this.getData().getProperty("/upload/watching"));
        },

        _attachHomeDropZone: function () {
            var oZone = this.byId("homeDropZone");
            var oDom = oZone && oZone.getDomRef();
            if (!oDom) {
                this._homeDropAttached = false;
                return;
            }
            if (this._homeDropAttached) {
                return;
            }
            this._homeDropAttached = true;
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
                    that._uploadFromHome(aFiles[0]);
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
