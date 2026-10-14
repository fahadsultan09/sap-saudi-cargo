sap.ui.define([], function () {
    "use strict";

    // Single place for backend calls: adds the user headers and turns the backend
    // error envelope {error: {code, message, details}} into a readable Error.
    function currentUser(oConfigData) {
        var aUsers = oConfigData.users || [];
        return aUsers.filter(function (oUser) {
            return oUser.id === oConfigData.currentUserId;
        })[0] || aUsers[0] || {};
    }

    function errorMessage(oBody, iStatus) {
        var oError = oBody && oBody.error;
        if (!oError) {
            return "Request failed (HTTP " + iStatus + ")";
        }
        var aDetails = (oError.details || []).map(function (oDetail) {
            var sField = (oDetail.location || []).slice(1).join(".");
            return (sField ? sField + ": " : "") + oDetail.message;
        });
        return [oError.message].concat(aDetails).join("\n");
    }

    function send(oConfigData, sMethod, sPath, vBody) {
        var oUser = currentUser(oConfigData);
        var mHeaders = { "X-User-ID": oUser.id || "", "X-User-Role": oUser.role || "" };
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
