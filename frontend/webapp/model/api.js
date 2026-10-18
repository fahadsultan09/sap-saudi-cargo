sap.ui.define([], function () {
    "use strict";

    // Single place for server calls. The app is served by the gateway, so calls are relative and carry the
    // session cookie; who the user is comes from that session, never from the browser.

    function signIn() {
        window.location.assign("/auth/login?returnTo=" + encodeURIComponent(window.location.hash || "#/dashboard"));
    }

    // The gateway turns every error into {error: {code, message}} with a message written for business users.
    function errorMessage(oBody) {
        return oBody && oBody.error ? oBody.error.message : "Something went wrong. Please try again.";
    }

    function send(sMethod, sPath, vBody) {
        var oOptions = { method: sMethod, headers: {}, credentials: "same-origin" };
        if (vBody instanceof FormData) {
            oOptions.body = vBody;
        } else if (vBody !== undefined) {
            oOptions.headers["Content-Type"] = "application/json";
            oOptions.body = JSON.stringify(vBody);
        }
        return fetch(sPath, oOptions).catch(function () {
            throw new Error("The application server cannot be reached. Check your connection and try again.");
        }).then(function (oResponse) {
            // An ended session sends the user to the sign-in page and back to where they were.
            if (oResponse.status === 401) {
                signIn();
            }
            return oResponse;
        });
    }

    function rejectWithBody(oResponse) {
        return oResponse.json().catch(function () {
            return null;
        }).then(function (oBody) {
            var oError = new Error(errorMessage(oBody));
            oError.status = oResponse.status;
            oError.body = oBody;
            throw oError;
        });
    }

    return {
        json: function (sMethod, sPath, vBody) {
            return send(sMethod, sPath, vBody).then(function (oResponse) {
                return oResponse.ok ? oResponse.json() : rejectWithBody(oResponse);
            });
        },

        blob: function (sPath) {
            return send("GET", sPath).then(function (oResponse) {
                return oResponse.ok ? oResponse.blob() : rejectWithBody(oResponse);
            });
        },

        signOut: function () {
            window.location.assign("/auth/logout");
        }
    };
});
