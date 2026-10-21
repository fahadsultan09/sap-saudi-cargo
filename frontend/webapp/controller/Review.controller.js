sap.ui.define([
    "saudicargo/ap/automation/controller/BaseController"
], function (BaseController) {
    "use strict";

    // Deep-link route (#/review/:caseId). Panel UI lives in ReviewPanel.
    return BaseController.extend("saudicargo.ap.automation.controller.Review", {
        onInit: function () {
            this.getRouter().getRoute("review").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function (oEvent) {
            var that = this;
            var sCaseId = oEvent.getParameter("arguments").caseId;
            if (sCaseId) {
                this.getCaseStore().loadCase(sCaseId).then(function () {
                    if (that.getData().getProperty("/selectedInvoice/isProcessing")) {
                        that.getData().setProperty("/reviewTabKey", "steps");
                    }
                });
            }
        }
    });
});
