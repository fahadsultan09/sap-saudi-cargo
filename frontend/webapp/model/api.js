sap.ui.define([], function () {
    "use strict";

    // Single place for backend calls: adds the user headers and turns error responses into a readable Error.
    function currentUser(oConfigData) {
        var aUsers = oConfigData.users || [];
        return aUsers.filter(function (oUser) {
            return oUser.id === oConfigData.currentUserId;
        })[0] || aUsers[0] || {};
    }

    // Understands the gateway's {error: {message}} and the agentic API's FastAPI {detail} formats.
    function errorMessage(oBody, iStatus) {
        var vDetail = oBody && oBody.detail;
        if (oBody && oBody.error) {
            return oBody.error.message;
        }
        if (typeof vDetail === "string") {
            return vDetail;
        }
        if (Array.isArray(vDetail)) {
            return vDetail.map(function (oItem) {
                return (oItem.loc || []).slice(1).join(".") + ": " + oItem.msg;
            }).join("\n");
        }
        if (vDetail && vDetail.message) {
            return vDetail.message + (vDetail.fields ? ": " + vDetail.fields.join(", ") : "");
        }
        return "Request failed (HTTP " + iStatus + ")";
    }

    function send(oConfigData, sMethod, sPath, vBody) {
        var oUser = currentUser(oConfigData);
        var mHeaders = { "X-User-Id": oUser.id || "", "X-User-Role": oUser.role || "" };
        var oOptions = { method: sMethod, headers: mHeaders };
        if (vBody instanceof FormData) {
            oOptions.body = vBody;
        } else if (vBody !== undefined) {
            mHeaders["Content-Type"] = "application/json";
            oOptions.body = JSON.stringify(vBody);
        }
        var sBase = String(oConfigData.apiBaseUrl || "").replace(/\/$/, "");
        return fetch(sBase + sPath, oOptions).catch(function () {
            throw new Error("Cannot reach the backend at " + sBase + ". Is it running?");
        });
    }

    function rejectWithBody(oResponse) {
        return oResponse.json().catch(function () {
            return null;
        }).then(function (oBody) {
            var oError = new Error(errorMessage(oBody, oResponse.status));
            oError.status = oResponse.status;
            oError.body = oBody;
            throw oError;
        });
    }

    return {
        currentUser: currentUser,

        json: function (oConfigData, sMethod, sPath, vBody) {
            return send(oConfigData, sMethod, sPath, vBody).then(function (oResponse) {
                return oResponse.ok ? oResponse.json() : rejectWithBody(oResponse);
            });
        },

        blob: function (oConfigData, sPath) {
            return send(oConfigData, "GET", sPath).then(function (oResponse) {
                return oResponse.ok ? oResponse.blob() : rejectWithBody(oResponse);
            });
        }
    };
});
