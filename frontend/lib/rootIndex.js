// Dev server entry: the app is only usable through the gateway (sign-in, /api, client profile).
// Opening this server directly sends the browser to the gateway; the gateway's own page requests carry
// X-Forwarded-Host and are served normally, with "/" answered by index.html.
module.exports = function () {
    var sGatewayUrl = (process.env.AP_GATEWAY_URL || "http://localhost:8000").replace(/\/$/, "");
    return function (req, res, next) {
        var bEntryPage = req.path === "/" || req.path === "/index.html";
        if (bEntryPage && !req.headers["x-forwarded-host"]) {
            res.writeHead(302, { Location: sGatewayUrl + "/" });
            res.end();
            return;
        }
        if (req.path === "/") {
            req.url = "/index.html" + req.url.slice(1);
        }
        next();
    };
};
