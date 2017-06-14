'use strict';
const _ = require('lodash');

let Store = require("./lib/store"),
    db;

const defaultOpts = {
    lifetime: 100,
    freeRetries: 2,
    refreshTimeoutOnRequest: false,
    minWait: 100,
    total: 20,
    whitelist: '',
    handleStoreError: function (rs) {
        throw new Error(rs.message);
    }
};

module.exports = function (app) {
    return function (opts) {
        switch (opts.cacheType) {
            case 'redis':
                db = new Store.Redis();
                break;
            case 'cookie':
                db = new Store.Cookie();
                break;
            case 'session':
                db = new Store.Session();
                break;
        }
        let middleware = function (req, res, next) {
            if (opts.whitelist && opts.whitelist(req)) return next()

            opts.lookup = Array.isArray(opts.lookup) ? opts.lookup : [opts.lookup]
            opts.onRateLimited = typeof opts.onRateLimited === 'function' ? opts.onRateLimited : function (req, res, next) {
                    res.status(429).send('Rate limit exceeded')
                }
            let lookups = opts.lookup.map(function (item) {
                return item + ':' + item.split('.').reduce(function (prev, cur) {
                        return prev[cur]
                    }, req)
            }).join(':')
            let path = opts.path || req.path
            let method = (opts.method || req.method).toLowerCase()

            let now = Date.now();

            db.refresh(_.extend(defaultOpts, {
                req: req,
                res: res,
                next: next
            }, opts))

            let key = 'ratelimit:' + path + ':' + method + ':' + lookups

            db.get(key, (err, value) => {
                if (err) {
                    opts.handleStoreError({
                        req: req,
                        res: res,
                        next: next,
                        message: "Cannot get request count",
                        parent: err
                    });
                    return;
                }

                var count = 0,
                    lastValidRequestTime = now,
                    firstRequestTime = lastValidRequestTime;
                if (value) {
                    count = value.count;
                    lastValidRequestTime = value.lastRequest.getTime();
                    firstRequestTime = value.firstRequest.getTime();

                    // var delayIndex = value.count - opts.freeRetries - 1;
                    // if (delayIndex >= 0) {
                    //     if (delayIndex < this.delays.length) {
                    //         delay = this.delays[delayIndex];
                    //     } else {
                    //         delay = opts.maxWait;
                    //     }
                    // }
                }
                var nextValidRequestTime = lastValidRequestTime + opts.minWait,
                    remainingLifetime = opts.lifetime || 0;

                if (!opts.refreshTimeoutOnRequest && remainingLifetime > 0) {
                    remainingLifetime = remainingLifetime - Math.floor((Date.now() - firstRequestTime) / 1000);
                    if (remainingLifetime < 1) {
                        // it should be expired alredy, treat this as a new request and reset everything
                        count = 0;
                        nextValidRequestTime = firstRequestTime = lastValidRequestTime = now;
                        remainingLifetime = opts.lifetime || 0;
                    }
                }

                value.remaining = Math.max(Number(value.remaining + value.freeRetries) - 1, -1)

                if (nextValidRequestTime >= now || value.remaining >=0 ) {
                    db.set(key, {
                        count: count + 1,
                        lastRequest: new Date(now),
                        firstRequest: new Date(firstRequestTime)
                    }, remainingLifetime, (err) => {
                        if (err) {
                            opts.handleStoreError({
                                req: req,
                                res: res,
                                next: next,
                                message: "Cannot increment request count",
                                parent: err
                            });
                            return;
                        }
                        typeof next == 'function' && next();
                    });
                } else {
                    if (!opts.skipHeaders) {
                        res.set('X-RateLimit-Limit', value.total)
                        res.set('X-RateLimit-Reset', Math.ceil((remainingLifetime + now) / 1000)) // UTC epoch seconds
                        res.set('X-RateLimit-Remaining', remainingLifetime)
                        res.set('Retry-After', remainingLifetime)
                    }
                    var failCallback = opts.onRateLimited();
                    typeof failCallback === 'function' && failCallback(req, res, next, new Date(nextValidRequestTime));
                }
            });
        }
        if (typeof(opts.lookup) === 'function') {
            middleware = function (middleware, req, res, next) {
                return opts.lookup(req, res, opts, function () {
                    return middleware(req, res, next)
                })
            }.bind(this, middleware)
        }
        if (opts.method && opts.path) app[opts.method](opts.path, middleware)
        return middleware
    }
}
