const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

test("concurrent expired-session calls replace history with one login navigation", async () => {
    const navigations = [];
    const listeners = {};
    let api;
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../webapp/model/api.js"), "utf8"), {
        sap: {ui: {define: (deps, factory) => { api = factory(); }}},
        window: {location: {hash: "#/review/case-1", replace: value => navigations.push(value)}, addEventListener: (name, callback) => { listeners[name] = callback; }},
        FormData: class {},
        fetch: async () => ({status: 401, ok: false, json: async () => ({error: {message: "Sign in"}})})
    });
    const results = await Promise.allSettled([api.json("GET", "/auth/me"), api.json("GET", "/api/v1/cases")]);
    assert(results.every(result => result.status === "rejected"));
    assert.deepEqual(navigations, ["/auth/login?returnTo=%23%2Freview%2Fcase-1"]);
    listeners.pageshow({persisted: true});
    await assert.rejects(api.json("GET", "/auth/me"));
    assert.equal(navigations.length, 2, "A restored page can sign in again if its session expired");
});
