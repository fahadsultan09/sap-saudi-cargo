sap.ui.define([
    "saudicargo/ap/automation/controller/BaseController"
], function (BaseController) {
    "use strict";

    // Desk: KPIs + full cases board (fed by CaseStore.loadCases).
    return BaseController.extend("saudicargo.ap.automation.controller.Desk", {
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

        onPreviousPage: function () {
            this.getCaseStore().showPage(this.getData().getProperty("/page/index") - 1);
        },

        onNextPage: function () {
            this.getCaseStore().showPage(this.getData().getProperty("/page/index") + 1);
        },

        onGoQueue: function () {
            this.navTo("approvals");
        }
    });
});
