// Serves the app at "/" so local addresses read http://localhost:8080/#/dashboard instead of /index.html#/dashboard.
module.exports = function () {
    return function (req, res, next) {
        if (req.path === "/") {
            req.url = "/index.html" + req.url.slice(1);
        }
        next();
    };
};
