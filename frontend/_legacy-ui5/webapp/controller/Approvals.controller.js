sap.ui.define([
    "saudicargo/ap/automation/controller/BaseController"
], function (BaseController) {
    "use strict";

    return BaseController.extend("saudicargo.ap.automation.controller.Approvals", {
        // Numbers the rows in the first column after every reload.
        onTableUpdateFinished: function (oEvent) {
            oEvent.getSource().getItems().forEach(function (oItem, i) {
                oItem.getCells()[0].setText(String(i + 1));
            });
        }
    });
});
