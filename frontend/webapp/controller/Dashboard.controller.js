sap.ui.define([
    "saudicargo/ap/automation/controller/BaseController",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "saudicargo/ap/automation/model/constants"
], function (BaseController, MessageToast, MessageBox, C) {
    "use strict";

    // Home: every invoice (KPI tiles, search, filters, list), and uploads with their live pipeline and review.
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

        onRefreshCases: function () {
            this.getCaseStore().loadCases();
        },

        onStatusFilterPress: function (oEvent) {
            var oButton = oEvent.getSource();
            // Pressing the active filter again must not switch it off.
            oButton.setPressed(true);
            this.getData().setProperty("/statusFilter", oButton.getBindingContext("apData").getProperty("key"));
            this.getCaseStore().applyStatusFilter(true);
        },

        onKpiPress: function (oEvent) {
            this.getData().setProperty("/statusFilter",
                oEvent.getParameter("listItem").getBindingContext("apData").getProperty("filterKey"));
            this.getCaseStore().applyStatusFilter(true);
        },

        onSearch: function (oEvent) {
            this.getData().setProperty("/searchQuery", oEvent.getSource().getValue());
            this.getCaseStore().applyStatusFilter(true);
        },

        onPreviousPage: function () {
            this.getCaseStore().showPage(this.getData().getProperty("/page/index") - 1);
        },

        onNextPage: function () {
            this.getCaseStore().showPage(this.getData().getProperty("/page/index") + 1);
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

        // Needs review / Review invoice: scroll to the panel under the pipeline and open its Overview tab.
        onReviewHomePipeline: function () {
            var that = this;
            var sCaseId = this.getData().getProperty("/upload/caseId");
            this.getData().setProperty("/upload/homeReview", true);
            this.getData().setProperty("/reviewTabKey", "overview");
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

        // A step on the pipeline (once processing is done): open the review below and show that step's outcome.
        onPipelineStep: function (oEvent) {
            var oBus = this.getOwnerComponent().getEventBus();
            var sTarget = this.getCaseStore().stepTarget(oEvent.getSource().getBindingContext("apData").getProperty("key"));
            this.getData().setProperty("/upload/homeReview", true);
            // Let the review panel render first when it was not shown yet.
            setTimeout(function () {
                oBus.publish("review", "goTo", { target: sTarget });
            }, 100);
        },

        onDismissHomePipeline: function () {
            this.getCaseStore().clearUploadTheater();
            this.getCaseStore().loadCases();
        },

        _uploadFromHome: function (oFile) {
            var that = this;
            this.getCaseStore().uploadInvoiceFile(oFile).then(function (oOutcome) {
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
                    that.getData().setProperty("/upload/nowText", "Open the invoice from the list below to keep watching.");
                }
            }).catch(function (oError) {
                MessageBox.error(oError.message);
            }).finally(function () {
                var oUploader = that.byId("homeFileUploader");
                if (oUploader) {
                    oUploader.clear();
                }
            });
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
                    oZone.addStyleClass("apWelcome--dragover");
                }
            };
            var fnOut = function (e) {
                e.preventDefault();
                e.stopPropagation();
                oZone.removeStyleClass("apWelcome--dragover");
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
