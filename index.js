'use strict';
const _ = require('lodash');

let Store = require("./lib/store"),
    db;

const defaultOpts = {
    freeRetries: 0,
    refreshTimeoutOnRequest: false,
    minWait: 0,
    total: 0,
    whitelist: '',
    cacheType: 'redis',
    minLimit: true,
    countLimit: true,
    db: {
        client: false,
        lifetime: 1000,
    },
    handleStoreError: function (rs) {
        throw new Error(rs.message);
    }
};

const dbOptsKey = ['db'];

module.exports = function (app) {
    return function (opts) {
        let curOpts = _.merge(defaultOpts, opts);

        switch (curOpts.cacheType.toLowerCase()) {
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
            if (curOpts.whitelist && curOpts.whitelist(req)) return next()

            curOpts.lookup = Array.isArray(curOpts.lookup) ? curOpts.lookup : [curOpts.lookup]
            curOpts.onRateLimited = typeof curOpts.onRateLimited === 'function' ? curOpts.onRateLimited : function (req, res, next) {
                    res.status(429).send('Rate limit exceeded')
                }
            let lookups = curOpts.lookup.map(function (item) {
                return item + ':' + item.split('.').reduce(function (prev, cur) {
                        return prev[cur]
                    }, req)
            }).join(':')

            let path = curOpts.path || req.path
            let method = (curOpts.method || req.method).toLowerCase()

            let now = Date.now();

            db.refresh(_.extend({
                req: req,
                res: res,
                next: next
            }, curOpts.db));

            let key = 'ratelimit:' + path + ':' + method + ':' + lookups

            db.get(key, (err, value) => {
                if (err) {
                    curOpts.handleStoreError({
                        req: req,
                        res: res,
                        next: next,
                        message: "Cannot get request count",
                        parent: err
                    });
                    return;
                }

                var lastValidRequestTime = now,
                    isFirst = true,
                    firstRequestTime = lastValidRequestTime,
                    remaining = curOpts.total;
                if (value = JSON.parse(value)) {
                    lastValidRequestTime = value.lastRequest;
                    firstRequestTime = value.firstRequest;
                    remaining = value.remaining;
                    isFirst = false;
                    // var delayIndex = value.count - opts.freeRetries - 1;
                    // if (delayIndex >= 0) {
                    //     if (delayIndex < this.delays.length) {
                    //         delay = this.delays[delayIndex];
                    //     } else {
                    //         delay = opts.maxWait;
                    //     }
                    // }
                }
                var nextValidRequestTime = lastValidRequestTime + curOpts.minWait,
                    diffRequestTime = Math.floor((now - lastValidRequestTime)),
                    remainingLifetime = curOpts.db.lifetime || 0;

                if (!curOpts.refreshTimeoutOnRequest && remainingLifetime > 0) {
                    remainingLifetime = remainingLifetime - Math.floor((now - firstRequestTime));
                    if (remainingLifetime < 1) {
                        // it should be expired alredy, treat this as a new request and reset everything
                        nextValidRequestTime = firstRequestTime = lastValidRequestTime = now;
                        remainingLifetime = curOpts.db.lifetime || 0;
                    }
                }

                remaining = Math.max(Number(remaining + curOpts.freeRetries) - 1, -1)

                if ((!curOpts.minLimit || (isFirst || diffRequestTime >= opts.minWait)) && (!curOpts.countLimit || remaining >= 0)) {
                    db.set(key, {
                        lastRequest: now,
                        firstRequest: firstRequestTime,
                        remaining: remaining
                    }, remainingLifetime, (err) => {
                        if (err) {
                            curOpts.handleStoreError({
                                req: req,
                                res: res,
                                next: next,
                                message: "Cannot increment request count",
                                parent: err
                            });
                            return;
                        }
                        next();
                    });
                } else {
                    if (!opts.skipHeaders && remaining < 0) {
                        res.set('X-RateLimit-Limit', opts.total)
                        res.set('X-RateLimit-Reset', Math.ceil((remainingLifetime + now) / 1000)) // UTC epoch seconds
                        res.set('X-RateLimit-Remaining', remainingLifetime)
                        res.set('Retry-After', remainingLifetime)
                    }
                    var failCallback = opts.onRateLimited;
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
