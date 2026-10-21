sap.ui.define([
    "saudicargo/ap/automation/controller/BaseController",
    "sap/ui/core/Fragment",
    "sap/m/MessageToast",
    "saudicargo/ap/automation/model/api"
], function (BaseController, Fragment, MessageToast, api) {
    "use strict";

    // The shell around every screen: header and user menu (no side nav).
    return BaseController.extend("saudicargo.ap.automation.controller.App", {
        onInit: function () {
            this._casesLoaded = false;
            this.getRouter().attachRouteMatched(this._onRouteMatched, this);
        },

        // Remembers the current screen and refreshes the lists where they are shown.
        _onRouteMatched: function (oEvent) {
            var sRoute = oEvent.getParameter("name");
            // The bare address shows the dashboard under its own name, #/dashboard (replacing the history entry).
            if (sRoute === "home") {
                this.getRouter().navTo("dashboard", {}, true);
                return;
            }
            this.getData().setProperty("/section", sRoute);
            if (!this._casesLoaded || sRoute === "dashboard" || sRoute === "desk" || sRoute === "approvals") {
                this._casesLoaded = true;
                this.getCaseStore().loadCases();
            }
        },

        onGoHome: function () {
            this.navTo("dashboard");
        },

        onGoDesk: function () {
            this.navTo("desk");
        },

        onGoApprovals: function () {
            this.navTo("approvals");
        },

        // ------------------------------------------------------------- user menu

        onOpenProfileMenu: function (oEvent) {
            var that = this;
            var oAvatar = oEvent.getSource();
            if (this.getData().getProperty("/busy")) {
                MessageToast.show("Please wait until the current action finishes.");
                return;
            }
            if (!this._profileMenu) {
                this._profileMenu = Fragment.load({
                    id: this.getView().getId(),
                    name: "saudicargo.ap.automation.view.fragments.ProfileMenu",
                    controller: this
                }).then(function (oPopover) {
                    that.getView().addDependent(oPopover);
                    return oPopover;
                });
            }
            this._profileMenu.then(function (oPopover) {
                oPopover.openBy(oAvatar);
            });
        },

        // Ends the session in the gateway and at the identity provider, then shows the sign-in page.
        onSignOut: function () {
            api.signOut();
        }
    });
});
