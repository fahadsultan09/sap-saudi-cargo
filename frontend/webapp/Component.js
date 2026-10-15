sap.ui.define([
    "sap/ui/core/UIComponent",
    "saudicargo/ap/automation/model/CaseStore"
], function (UIComponent, CaseStore) {
    "use strict";

    return UIComponent.extend("saudicargo.ap.automation.Component", {
        metadata: {
            manifest: "json"
        },

        init: function () {
            UIComponent.prototype.init.apply(this, arguments);
            var oConfigModel = this.getModel("config");
            this._caseStore = new CaseStore(oConfigModel);
            this.setModel(this._caseStore.getModel(), "apData");
            // Every API call sends the current user, so routing starts once the users are loaded.
            oConfigModel.dataLoaded().then(function () {
                this._caseStore.applyTimeZone();
                this._caseStore.applyCurrentUser();
                this.getRouter().initialize();
            }.bind(this));
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
