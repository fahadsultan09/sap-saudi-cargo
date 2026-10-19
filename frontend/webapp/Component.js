sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "saudicargo/ap/automation/model/api",
    "saudicargo/ap/automation/model/CaseStore"
], function (UIComponent, JSONModel, MessageBox, api, CaseStore) {
    "use strict";

    // Client profile colour -> CSS token the stylesheet (and the UI5 theme variables) read.
    var BRAND_TOKENS = {
        brand: "--ap-brand",
        brandDark: "--ap-brand-dark",
        brandLight: "--ap-brand-light",
        brandSoft: "--ap-brand-soft"
    };

    return UIComponent.extend("saudicargo.ap.automation.Component", {
        metadata: {
            manifest: "json"
        },

        init: function () {
            UIComponent.prototype.init.apply(this, arguments);
            var oClientModel = new JSONModel({ branding: {} });
            this.setModel(oClientModel, "client");
            this._caseStore = new CaseStore(oClientModel);
            this.setModel(this._caseStore.getModel(), "apData");
            // Every screen needs the client profile and the signed-in user, so routing starts once both are in.
            // Without a session the /auth/me call sends the browser to the sign-in page instead.
            Promise.all([api.json("GET", "/config/client"), api.json("GET", "/auth/me")]).then(function (aResults) {
                oClientModel.setData(aResults[0]);
                this._applyBranding(aResults[0]);
                this._caseStore.applyTimeZone();
                this._caseStore.applyCurrentUser(aResults[1]);
                // Signed in but given no role in the identity provider: nothing in the app is allowed.
                if (!aResults[1].roles.length) {
                    MessageBox.warning("Your account has no access to " + aResults[0].branding.appTitle
                        + " yet. Please ask your administrator to assign you a role.");
                    return;
                }
                this.getRouter().initialize();
            }.bind(this)).catch(function (oError) {
                if (oError.status !== 401) {
                    MessageBox.error(oError.message);
                }
            });
        },

        _applyBranding: function (oClient) {
            var oStyle = document.documentElement.style;
            var mColors = oClient.branding.colors || {};
            Object.keys(BRAND_TOKENS).forEach(function (sKey) {
                if (mColors[sKey]) {
                    oStyle.setProperty(BRAND_TOKENS[sKey], mColors[sKey]);
                }
            });
            document.title = oClient.branding.appTitle + " · " + oClient.name;
        },

        getCaseStore: function () {
            return this._caseStore;
        },

        destroy: function () {
            this._caseStore.destroy();
            UIComponent.prototype.destroy.apply(this, arguments);
        }
    });
});
