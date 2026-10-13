sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (Controller, MessageToast, MessageBox) {
    "use strict";

    var PENDING_STATUSES = [
        "RECEIVED",
        "NEEDS_REVIEW",
        "EXTRACTED",
        "WAITING_EXTERNAL",
        "AWAITING_CONFIRM",
        "AWAITING_APPROVAL"
    ];
    var APPROVED_STATUSES = [
        "READY_TO_POST",
        "POSTING",
        "POST_UNKNOWN",
        "POST_FAILED",
        "RECONCILIATION_FAILED"
    ];
    var POSTED_STATUSES = ["POSTED", "RECONCILED", "INFORMED"];

    var STATUS_LABELS = {
        RECEIVED: "Pending",
        NEEDS_REVIEW: "Review Required",
        EXTRACTED: "Extracted",
        WAITING_EXTERNAL: "Waiting External",
        AWAITING_CONFIRM: "Awaiting Confirm",
        AWAITING_APPROVAL: "Pending Approval",
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
        vendor: "Vendor Name",
        invoice_number: "Invoice Number",
        invoiceDate: "Invoice Date",
        po_number: "PO Number",
        net: "Total Amount",
        vat: "VAT Amount",
        currency: "Currency"
    };

    var FIELD_ORDER = ["vendor", "invoice_number", "po_number", "net", "vat", "currency"];

    var ACTION_LABELS = {
        POST: "APPROVE",
        HOLD: "HOLD",
        REJECT: "REJECT"
    };

    return Controller.extend("saudicargo.ap.automation.controller.App", {
        onInit: function () {
            this._documentBlobUrl = null;
            this._bindDashboardLoad();
            this._bindInvoiceReviewLoad();
        },

        _bindDashboardLoad: function () {
            var oConfig = this.getOwnerComponent().getModel("config");
            if (!oConfig) {
                return;
            }
            if (oConfig.getProperty("/apiBaseUrl")) {
                this._loadDashboardData();
                return;
            }
            oConfig.attachRequestCompleted(this._loadDashboardData, this);
        },

        _bindInvoiceReviewLoad: function () {
            var oConfig = this.getOwnerComponent().getModel("config");
            if (!oConfig) {
                return;
            }
            if (oConfig.getProperty("/apiBaseUrl")) {
                if (oConfig.getProperty("/selectedCaseId")) {
                    this._loadInvoiceReview();
                }
                return;
            }
            oConfig.attachRequestCompleted(function () {
                if (oConfig.getProperty("/selectedCaseId")) {
                    this._loadInvoiceReview();
                }
            }, this);
        },

        onTabSelect: function (oEvent) {
            var sKey = oEvent.getParameter("key");
            if (sKey === "review") {
                this._loadInvoiceReview();
            }
        },

        onRecentActivityPress: function (oEvent) {
            var oCtx = oEvent.getSource().getBindingContext("apData");
            var oRow = oCtx ? oCtx.getObject() : null;
            var sCaseId = oRow && oRow.caseId;
            var oConfig = this.getOwnerComponent().getModel("config");
            var oConfigData = oConfig ? oConfig.getData() : null;
            var oTabBar = this.byId("idIconTabBar");

            if (oTabBar) {
                oTabBar.setSelectedKey("review");
            }

            if (oConfigData && oConfigData.useMocks) {
                return;
            }

            if (!sCaseId) {
                MessageToast.show("No case id on this row — upload a case first");
                return;
            }

            if (oConfig) {
                oConfig.setProperty("/selectedCaseId", sCaseId);
            }
            this._loadInvoiceReview();
        },

        onOpenDocument: function () {
            var oApData = this.getOwnerComponent().getModel("apData");
            var sUrl = oApData ? oApData.getProperty("/selectedInvoice/documentUrl") : "";
            if (!sUrl) {
                MessageToast.show("No document available for this case");
                return;
            }
            window.open(sUrl, "_blank");
        },

        _loadDashboardData: function () {
            var oConfig = this.getOwnerComponent().getModel("config");
            var oConfigData = oConfig ? oConfig.getData() : null;
            if (!oConfigData || oConfigData.useMocks) {
                return;
            }

            var sBase = String(oConfigData.apiBaseUrl || "").replace(/\/$/, "");
            var sUserId = oConfigData.userId || "demo-user";
            var mHeaders = { "X-User-ID": sUserId };
            var that = this;

            Promise.all([
                that._fetchJson(sBase + "/api/v1/dashboard", mHeaders),
                that._fetchJson(sBase + "/api/v1/cases?limit=20", mHeaders)
            ]).then(function (aResults) {
                that._applyDashboard(aResults[0], aResults[1]);
            }).catch(function () {
                MessageToast.show("API unavailable — showing mock dashboard data");
            });
        },

        _loadInvoiceReview: function () {
            var oConfig = this.getOwnerComponent().getModel("config");
            var oConfigData = oConfig ? oConfig.getData() : null;
            if (!oConfigData || oConfigData.useMocks) {
                return;
            }

            var sBase = String(oConfigData.apiBaseUrl || "").replace(/\/$/, "");
            var sUserId = oConfigData.userId || "demo-user";
            var mHeaders = { "X-User-ID": sUserId };
            var that = this;

            this._resolveCaseId(oConfigData, sBase, mHeaders).then(function (sCaseId) {
                if (!sCaseId) {
                    MessageToast.show("Upload a case first");
                    return;
                }
                if (oConfig) {
                    oConfig.setProperty("/selectedCaseId", sCaseId);
                }
                return that._fetchJson(sBase + "/api/v1/cases/" + encodeURIComponent(sCaseId), mHeaders)
                    .then(function (oCase) {
                        that._applySelectedInvoice(oCase);
                        that._loadDocumentPreview(sBase, sCaseId, mHeaders, oCase);
                    });
            }).catch(function () {
                MessageToast.show("Could not load invoice review from API");
            });
        },

        _resolveCaseId: function (oConfigData, sBase, mHeaders) {
            var sSelected = oConfigData.selectedCaseId;
            if (sSelected) {
                return Promise.resolve(sSelected);
            }

            var oApData = this.getOwnerComponent().getModel("apData");
            var aRecent = oApData ? oApData.getProperty("/recentActivity") || [] : [];
            var oFirst = aRecent[0];
            if (oFirst && oFirst.caseId) {
                return Promise.resolve(oFirst.caseId);
            }

            return this._fetchJson(sBase + "/api/v1/cases?limit=1", mHeaders).then(function (oList) {
                var aItems = (oList && oList.items) || [];
                return aItems[0] ? aItems[0].id : "";
            }).catch(function () {
                return "";
            });
        },

        _applySelectedInvoice: function (oCase) {
            var oApData = this.getOwnerComponent().getModel("apData");
            if (!oApData || !oCase) {
                return;
            }
            oApData.setProperty("/selectedInvoice", this._mapCaseToSelectedInvoice(oCase));
        },

        _mapCaseToSelectedInvoice: function (oCase) {
            var oInvoice = oCase.invoice || {};
            var mFields = oCase.fields || {};
            var oRec = oCase.recommendation || null;
            var sStatus = oCase.status || "";
            var aExtracted = this._mapExtractedFields(oCase);
            var fAvgConfidence = this._averageFieldConfidence(mFields);
            var sRecommendation = this._recommendationLabel(oCase, oRec);
            var iRisk = this._inventRiskScore(oCase, oRec, fAvgConfidence);
            var sConfidenceState = this._confidenceStateForCase(sStatus, iRisk, oRec);
            var sVendor = this._fieldOrInvoice(mFields, oInvoice, "vendor") || "—";
            var sInvNo = this._fieldOrInvoice(mFields, oInvoice, "invoice_number") || oCase.id || "—";
            var sPo = this._fieldOrInvoice(mFields, oInvoice, "po_number") || "—";
            var sCurrency = this._fieldOrInvoice(mFields, oInvoice, "currency") || "SAR";
            var sAmount = this._formatMoney(this._fieldOrInvoice(mFields, oInvoice, "net"));
            var sVat = this._formatMoney(this._fieldOrInvoice(mFields, oInvoice, "vat"));
            var oDoc = oCase.document || {};

            return {
                id: sInvNo,
                caseId: oCase.id || "",
                vendor: sVendor,
                invoiceDate: "",
                poNumber: sPo,
                amount: sAmount,
                vat: sVat,
                currency: sCurrency,
                recommendation: sRecommendation,
                riskScore: iRisk,
                confidenceState: sConfidenceState,
                reasons: this._mapReasons(oCase, oRec),
                extractedFields: aExtracted,
                documentFilename: oDoc.filename || ((sInvNo !== "—" ? sInvNo : "invoice") + ".pdf"),
                documentUrl: "",
                status: STATUS_LABELS[sStatus] || sStatus
            };
        },

        _fieldOrInvoice: function (mFields, oInvoice, sKey) {
            if (mFields[sKey] && mFields[sKey].value != null && mFields[sKey].value !== "") {
                return String(mFields[sKey].value);
            }
            if (oInvoice && oInvoice[sKey] != null && oInvoice[sKey] !== "") {
                return String(oInvoice[sKey]);
            }
            return "";
        },

        _formatMoney: function (vValue) {
            if (vValue == null || vValue === "") {
                return "—";
            }
            var fNum = Number(vValue);
            if (isNaN(fNum)) {
                return String(vValue);
            }
            return fNum.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
        },

        _mapExtractedFields: function (oCase) {
            var mFields = oCase.fields || {};
            var oInvoice = oCase.invoice || {};
            var aRows = [];
            var that = this;
            var bHasAny = FIELD_ORDER.some(function (sKey) {
                return that._fieldOrInvoice(mFields, oInvoice, sKey) !== "";
            });

            if (!bHasAny) {
                return [{
                    field: "Extraction",
                    value: "No fields extracted yet — case needs manual review",
                    confidence: "n/a",
                    state: "Warning"
                }];
            }

            FIELD_ORDER.forEach(function (sKey) {
                var oField = mFields[sKey] || {};
                var sValue = that._fieldOrInvoice(mFields, oInvoice, sKey);
                var fConf = typeof oField.confidence === "number" ? oField.confidence : null;
                if (sKey === "net" || sKey === "vat") {
                    sValue = that._formatMoney(sValue === "" ? null : sValue);
                    if (sValue !== "—" && oInvoice.currency) {
                        sValue = sValue + " " + oInvoice.currency;
                    } else if (sValue !== "—" && mFields.currency && mFields.currency.value) {
                        sValue = sValue + " " + mFields.currency.value;
                    }
                }
                aRows.push({
                    field: FIELD_LABELS[sKey] || sKey,
                    value: sValue || "—",
                    confidence: fConf == null ? "n/a" : Math.round(fConf * 100) + "%",
                    state: that._confidenceState(fConf)
                });
            });
            return aRows;
        },

        _confidenceState: function (fConf) {
            if (fConf == null) {
                return "Warning";
            }
            if (fConf >= 0.85) {
                return "Success";
            }
            if (fConf >= 0.5) {
                return "Warning";
            }
            return "Error";
        },

        _averageFieldConfidence: function (mFields) {
            var aVals = [];
            Object.keys(mFields || {}).forEach(function (sKey) {
                var fConf = mFields[sKey] && mFields[sKey].confidence;
                if (typeof fConf === "number") {
                    aVals.push(fConf);
                }
            });
            if (!aVals.length) {
                return null;
            }
            return aVals.reduce(function (a, b) { return a + b; }, 0) / aVals.length;
        },

        _recommendationLabel: function (oCase, oRec) {
            if (oRec && oRec.action) {
                return ACTION_LABELS[oRec.action] || oRec.action;
            }
            if (oCase.status === "NEEDS_REVIEW") {
                return "REVIEW REQUIRED";
            }
            return STATUS_LABELS[oCase.status] || oCase.status || "—";
        },

        _inventRiskScore: function (oCase, oRec, fAvgConfidence) {
            if (oRec && typeof oRec.confidence === "number") {
                return Math.max(0, Math.min(100, Math.round((1 - oRec.confidence) * 100)));
            }
            if (typeof fAvgConfidence === "number") {
                return Math.max(0, Math.min(100, Math.round((1 - fAvgConfidence) * 100)));
            }
            if (oCase.status === "NEEDS_REVIEW") {
                return 85;
            }
            return 50;
        },

        _confidenceStateForCase: function (sStatus, iRisk, oRec) {
            if (oRec && oRec.action === "POST" && iRisk <= 25) {
                return "Success";
            }
            if (oRec && oRec.action === "REJECT") {
                return "Error";
            }
            if (sStatus === "NEEDS_REVIEW" || iRisk >= 60) {
                return "Warning";
            }
            if (iRisk <= 25) {
                return "Success";
            }
            return "Warning";
        },

        _mapReasons: function (oCase, oRec) {
            var aReasons = [];
            if (oRec) {
                if (oRec.reason) {
                    aReasons.push({ text: oRec.reason });
                }
                (oRec.evidence || []).forEach(function (sText) {
                    if (sText) {
                        aReasons.push({ text: String(sText) });
                    }
                });
            }
            (oCase.rules || []).forEach(function (oRule) {
                if (oRule && oRule.passed === false) {
                    aReasons.push({
                        text: (oRule.code || "Rule") + ": " + (oRule.evidence || "failed")
                    });
                }
            });
            if (!aReasons.length) {
                if (oCase.status === "NEEDS_REVIEW") {
                    aReasons.push({
                        text: "Document extraction incomplete or failed — manual review required"
                    });
                } else {
                    aReasons.push({ text: "No agent reasoning available yet" });
                }
            }
            return aReasons;
        },

        _loadDocumentPreview: function (sBase, sCaseId, mHeaders, oCase) {
            var that = this;
            var oApData = this.getOwnerComponent().getModel("apData");
            if (!oApData) {
                return;
            }

            fetch(sBase + "/api/v1/cases/" + encodeURIComponent(sCaseId) + "/document", {
                headers: mHeaders
            }).then(function (oResponse) {
                if (!oResponse.ok) {
                    throw new Error("HTTP " + oResponse.status);
                }
                return oResponse.blob();
            }).then(function (oBlob) {
                that._revokeDocumentBlob();
                that._documentBlobUrl = URL.createObjectURL(oBlob);
                oApData.setProperty("/selectedInvoice/documentUrl", that._documentBlobUrl);
                if (oCase && oCase.document && oCase.document.filename) {
                    oApData.setProperty("/selectedInvoice/documentFilename", oCase.document.filename);
                }
            }).catch(function () {
                oApData.setProperty("/selectedInvoice/documentUrl", "");
            });
        },

        _revokeDocumentBlob: function () {
            if (this._documentBlobUrl) {
                URL.revokeObjectURL(this._documentBlobUrl);
                this._documentBlobUrl = null;
            }
        },

        _fetchJson: function (sUrl, mHeaders) {
            return fetch(sUrl, { headers: mHeaders }).then(function (oResponse) {
                if (!oResponse.ok) {
                    throw new Error("HTTP " + oResponse.status);
                }
                return oResponse.json();
            });
        },

        _applyDashboard: function (oDashboard, oCaseList) {
            var oApData = this.getOwnerComponent().getModel("apData");
            if (!oApData) {
                return;
            }

            var mCounts = (oDashboard && oDashboard.counts) || {};
            oApData.setProperty("/kpis", {
                total: oDashboard && typeof oDashboard.total === "number" ? oDashboard.total : 0,
                pending: this._sumCounts(mCounts, PENDING_STATUSES),
                approved: this._sumCounts(mCounts, APPROVED_STATUSES),
                posted: this._sumCounts(mCounts, POSTED_STATUSES)
            });

            var aItems = (oCaseList && oCaseList.items) || [];
            oApData.setProperty("/recentActivity", aItems.map(this._mapCaseToActivity.bind(this)));
        },

        _sumCounts: function (mCounts, aStatuses) {
            return aStatuses.reduce(function (iSum, sStatus) {
                return iSum + (mCounts[sStatus] || 0);
            }, 0);
        },

        _mapCaseToActivity: function (oCase) {
            var sStatus = oCase.status || "";
            return {
                id: this._caseInvoiceId(oCase),
                caseId: oCase.id || "",
                vendor: this._caseVendor(oCase),
                status: STATUS_LABELS[sStatus] || sStatus,
                state: STATUS_STATES[sStatus] || "None",
                date: this._formatDate(oCase.created_at)
            };
        },

        _caseVendor: function (oCase) {
            if (oCase.invoice && oCase.invoice.vendor) {
                return oCase.invoice.vendor;
            }
            if (oCase.fields && oCase.fields.vendor && oCase.fields.vendor.value) {
                return oCase.fields.vendor.value;
            }
            return "—";
        },

        _caseInvoiceId: function (oCase) {
            if (oCase.invoice && oCase.invoice.invoice_number) {
                return oCase.invoice.invoice_number;
            }
            if (oCase.fields && oCase.fields.invoice_number && oCase.fields.invoice_number.value) {
                return oCase.fields.invoice_number.value;
            }
            return oCase.id || "—";
        },

        _formatDate: function (sIso) {
            if (!sIso) {
                return "";
            }
            return String(sIso).slice(0, 16).replace("T", " ");
        },

        onUploadChange: function (oEvent) {
            var oConfig = this.getOwnerComponent().getModel("config");
            var oConfigData = oConfig ? oConfig.getData() : null;
            var aFiles = oEvent.getParameter("files") || [];
            var oFile = aFiles[0];

            if (!oConfigData || oConfigData.useMocks) {
                this._mockUploadProgress();
                return;
            }

            if (!oFile) {
                MessageToast.show("No file selected");
                return;
            }

            this._uploadInvoiceFile(oFile, oConfigData);
        },

        _mockUploadProgress: function () {
            var oProgress = this.byId("uploadProgress");
            var oSection = this.byId("processingSection");

            oSection.setVisible(true);
            oProgress.setState("Information");
            oProgress.setPercentValue(20);
            oProgress.setDisplayValue("Step 1/3: Document Received");

            setTimeout(function () {
                oProgress.setPercentValue(65);
                oProgress.setDisplayValue("Step 2/3: Sending to SAP Document AI...");
            }, 1500);

            setTimeout(function () {
                oProgress.setPercentValue(100);
                oProgress.setState("Success");
                oProgress.setDisplayValue("Step 3/3: Extraction & Business Rules Completed");
                MessageToast.show("Invoice uploaded and processed successfully!");
            }, 3500);
        },

        _uploadInvoiceFile: function (oFile, oConfigData) {
            var oProgress = this.byId("uploadProgress");
            var oSection = this.byId("processingSection");
            var sBase = String(oConfigData.apiBaseUrl || "").replace(/\/$/, "");
            var sUserId = oConfigData.userId || "demo-user";
            var oFormData = new FormData();
            var that = this;

            oSection.setVisible(true);
            oProgress.setState("Information");
            oProgress.setPercentValue(15);
            oProgress.setDisplayValue("Step 1/3: Document received — preparing upload…");

            // Field name must match FastAPI: file: UploadFile = File(...)
            // Do not set Content-Type — the browser adds multipart boundary.
            oFormData.append("file", oFile, oFile.name || "invoice.pdf");

            oProgress.setPercentValue(45);
            oProgress.setDisplayValue("Step 2/3: Uploading to API / Document AI…");

            fetch(sBase + "/api/v1/cases/upload", {
                method: "POST",
                headers: { "X-User-ID": sUserId },
                body: oFormData
            }).then(function (oResponse) {
                return oResponse.json().then(function (oBody) {
                    return { ok: oResponse.ok, status: oResponse.status, body: oBody };
                }).catch(function () {
                    return { ok: oResponse.ok, status: oResponse.status, body: null };
                });
            }).then(function (oResult) {
                that._handleUploadResult(oResult);
            }).catch(function () {
                oProgress.setPercentValue(100);
                oProgress.setState("Error");
                oProgress.setDisplayValue("Upload failed — API unreachable");
                MessageBox.error("Could not reach the API. Is the backend running on " + sBase + "?");
            });
        },

        _handleUploadResult: function (oResult) {
            var oProgress = this.byId("uploadProgress");
            var oConfig = this.getOwnerComponent().getModel("config");
            var oBody = oResult.body || {};
            var oError = oBody.error || {};
            var sCaseId = (oBody.id) || this._caseIdFromMessage(oError.message) || "";
            var sMessage = oError.message || ("HTTP " + oResult.status);

            if (oResult.ok && oBody.id) {
                if (oConfig) {
                    oConfig.setProperty("/selectedCaseId", oBody.id);
                }
                oProgress.setPercentValue(100);
                oProgress.setState("Success");
                oProgress.setDisplayValue("Step 3/3: Case " + oBody.id + " created");
                MessageToast.show("Invoice uploaded — case " + oBody.id);
                this._loadDashboardData();
                return;
            }

            // Document AI may fail with 502 after the case is already saved as NEEDS_REVIEW
            if (oResult.status === 502 || oError.code === "document_ai_failure") {
                if (sCaseId && oConfig) {
                    oConfig.setProperty("/selectedCaseId", sCaseId);
                }
                oProgress.setPercentValue(100);
                oProgress.setState("Warning");
                oProgress.setDisplayValue(
                    sCaseId
                        ? "Case " + sCaseId + " saved — extraction needs review"
                        : "Upload saved — extraction needs review"
                );
                MessageBox.warning(
                    "Document extraction failed (this often means SAP Document AI credentials are missing or invalid).\n\n"
                        + (sCaseId ? "Case " + sCaseId + " was still created and is available for manual review.\n\n" : "")
                        + "The dashboard will refresh so you can see the case."
                );
                this._loadDashboardData();
                return;
            }

            oProgress.setPercentValue(100);
            oProgress.setState("Error");
            oProgress.setDisplayValue("Upload failed");
            MessageBox.error("Upload failed: " + sMessage);
        },

        _caseIdFromMessage: function (sMessage) {
            if (!sMessage) {
                return "";
            }
            var aMatch = String(sMessage).match(/case\s+([A-Za-z0-9_-]+)/i);
            return aMatch ? aMatch[1] : "";
        },

        onApproveInvoice: function () {
            var oApData = this.getOwnerComponent().getModel("apData");
            var sId = oApData ? oApData.getProperty("/selectedInvoice/id") : "invoice";
            MessageBox.success("Invoice " + sId + " approved and sent for posting to SAP S/4HANA. (API wiring comes in Phase 4)");
        },

        onRejectInvoice: function () {
            var oApData = this.getOwnerComponent().getModel("apData");
            var sId = oApData ? oApData.getProperty("/selectedInvoice/id") : "invoice";
            MessageBox.warning("Invoice " + sId + " rejected and flagged for manual exception handling. (API wiring comes in Phase 4)");
        }
    });
});
