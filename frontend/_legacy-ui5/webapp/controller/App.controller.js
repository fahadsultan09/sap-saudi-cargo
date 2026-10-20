sap.ui.define([
    "saudicargo/ap/automation/controller/BaseController",
    "sap/ui/core/Fragment",
    "sap/m/MessageToast"
], function (BaseController, Fragment, MessageToast) {
    "use strict";

    // The shell around every screen: header, profile menu and side navigation.
    return BaseController.extend("saudicargo.ap.automation.controller.App", {
        onInit: function () {
            this._casesLoaded = false;
            this.getRouter().attachRouteMatched(this._onRouteMatched, this);
        },

        // Keeps the side navigation in sync with the route and refreshes the lists where they are shown.
        _onRouteMatched: function (oEvent) {
            var sRoute = oEvent.getParameter("name");
            // The bare address shows the dashboard under its own name, #/dashboard (replacing the history entry).
            if (sRoute === "home") {
                this.getRouter().navTo("dashboard", {}, true);
                return;
            }
            this.getData().setProperty("/section", sRoute);
            if (!this._casesLoaded || sRoute === "dashboard" || sRoute === "approvals") {
                this._casesLoaded = true;
                this.getCaseStore().loadCases();
            }
        },

        onToggleSideNav: function () {
            var oToolPage = this.byId("toolPage");
            oToolPage.setSideExpanded(!oToolPage.getSideExpanded());
        },

        // Invoice Review reopens the case that was last selected.
        onSectionSelect: function (oEvent) {
            var sKey = oEvent.getParameter("item").getKey();
            var sCaseId = this.getData().getProperty("/selectedCaseId");
            this.navTo(sKey, sKey === "review" && sCaseId ? { caseId: sCaseId } : {});
        },

        // ---------------------------------------------------------------- profile

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

        // A profile switch acts like a new sign-in: close the open case and return to the dashboard.
        onProfileSelect: function (oEvent) {
            var oProfile = oEvent.getParameter("listItem").getBindingContext("apData").getObject();
            var oStore = this.getCaseStore();
            this.byId("profileMenu").close();
            this.getConfig().setProperty("/currentUserId", oProfile.id);
            oStore.applyCurrentUser();
            oStore.clearCase();
            oStore.loadCases();
            this.navTo("dashboard");
            MessageToast.show("Switched to " + oProfile.name);
        }
    });
});
