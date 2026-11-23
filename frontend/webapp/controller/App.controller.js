sap.ui.define([
    "saudicargo/ap/automation/controller/BaseController",
    "sap/ui/core/Fragment",
    "sap/m/MessageToast",
    "saudicargo/ap/automation/model/api"
], function (BaseController, Fragment, MessageToast, api) {
    "use strict";

    // The shell around every screen: Saudia Cargo header, global search, user menu and side navigation.
    return BaseController.extend("saudicargo.ap.automation.controller.App", {
        onInit: function () {
            this._casesLoaded = false;
            this.getRouter().attachRouteMatched(this._onRouteMatched, this);
        },

        // Remembers the current screen and refreshes the lists where they are shown.
        _onRouteMatched: function (oEvent) {
            var sRoute = oEvent.getParameter("name");
            // Replace old bookmarks and the bare address with the dashboard's canonical URL.
            if (sRoute === "home" || sRoute === "legacyDesk") {
                this.getRouter().navTo("dashboard", {}, true);
                return;
            }
            this.getData().setProperty("/section", sRoute);
            if (!this._casesLoaded || sRoute === "dashboard" || sRoute === "approvals") {
                this._casesLoaded = true;
                this.getCaseStore().loadCases();
            }
        },

        // ------------------------------------------------------------- side navigation

        onToggleSideNav: function () {
            var oToolPage = this.byId("toolPage");
            if (oToolPage) {
                oToolPage.setSideExpanded(!oToolPage.getSideExpanded());
            }
        },

        onSectionSelect: function (oEvent) {
            var oItem = oEvent.getParameter("item");
            if (!oItem) {
                return;
            }
            var sKey = oItem.getKey();
            var oCaseStore = this.getCaseStore();

            if (sKey === "dashboard") {
                this.getData().setProperty("/invoiceTypeFilter", "");
                oCaseStore.applyStatusFilter(true);
                this.navTo("dashboard");
            } else if (sKey === "upload") {
                this.navTo("upload");
            } else if (sKey === "invoices_all") {
                this.getData().setProperty("/invoiceTypeFilter", "ALL");
                this.getData().setProperty("/section", "dashboard");
                oCaseStore.applyStatusFilter(true);
                this.navTo("dashboard");
            } else if (sKey === "invoices_direct") {
                this.getData().setProperty("/invoiceTypeFilter", "DIRECT");
                this.getData().setProperty("/section", "dashboard");
                oCaseStore.applyStatusFilter(true);
                this.navTo("dashboard");
            } else if (sKey === "invoices_intercompany") {
                this.getData().setProperty("/invoiceTypeFilter", "INTERCOMPANY");
                this.getData().setProperty("/section", "dashboard");
                oCaseStore.applyStatusFilter(true);
                this.navTo("dashboard");
            } else if (sKey === "credit_notes") {
                this.getData().setProperty("/invoiceTypeFilter", "CREDIT_NOTE");
                this.getData().setProperty("/section", "dashboard");
                oCaseStore.applyStatusFilter(true);
                this.navTo("dashboard");
            } else if (sKey === "reconciliations") {
                MessageToast.show("Reconciliations module is coming soon.");
            } else if (sKey === "review") {
                var sCaseId = this.getData().getProperty("/selectedCaseId");
                if (sCaseId) {
                    this.navTo("review", { caseId: sCaseId });
                } else {
                    this.getData().setProperty("/statusFilter", "needs_review");
                    oCaseStore.applyStatusFilter(true);
                    this.navTo("dashboard");
                }
            } else if (sKey === "approvals") {
                this.navTo("approvals");
            }
        },

        // ------------------------------------------------------------- global search

        onGlobalSearch: function (oEvent) {
            var sQuery = oEvent.getParameter("newValue") !== undefined
                ? oEvent.getParameter("newValue")
                : oEvent.getParameter("query");
            this.getData().setProperty("/searchQuery", sQuery || "");
            
            // If on another route, navigate to dashboard to show filtered results
            var sCurrentRoute = this.getData().getProperty("/section");
            if (sCurrentRoute !== "dashboard") {
                this.navTo("dashboard");
            } else {
                this.getCaseStore().applyStatusFilter(true);
            }
        },

        // ------------------------------------------------------------- notifications

        onNotificationPress: function () {
            var aApprovals = this.getData().getProperty("/approvals") || [];
            var aCases = this.getData().getProperty("/allCases") || [];
            var iNeedsReview = aCases.filter(function (c) { return c.statusCode === "NEEDS_REVIEW"; }).length;
            MessageToast.show("Notifications: " + iNeedsReview + " invoices need review, " + aApprovals.length + " awaiting approval.");
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
