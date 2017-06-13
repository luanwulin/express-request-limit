'use strict';
const _ = require('lodash');

let Store = require("./lib/store"),
    db;

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

            db.refresh(_.extend({
                req: req,
                res: res,
                next: next
            }, opts))

            let key = 'ratelimit:' + path + ':' + method + ':' + lookups

            db.get(key, function (err, limit) {
                if (err && opts.ignoreErrors) return next()
                let now = Date.now()
                limit = limit ? JSON.parse(limit) : {
                        total: opts.total,
                        remaining: opts.total,
                        reset: now + opts.expire
                    }

                if (now > limit.reset) {
                    limit.reset = now + opts.expire
                    limit.remaining = opts.total
                }

                // do not allow negative remaining
                limit.remaining = Math.max(Number(limit.remaining) - 1, -1)
                db.set(key, JSON.stringify(limit), opts.expire, function (e) {
                    if (!opts.skipHeaders) {
                        res.set('X-RateLimit-Limit', limit.total)
                        res.set('X-RateLimit-Reset', Math.ceil(limit.reset / 1000)) // UTC epoch seconds
                        res.set('X-RateLimit-Remaining', Math.max(limit.remaining, 0))
                    }

                    if (limit.remaining >= 0) return next()

                    let after = (limit.reset - Date.now()) / 1000

                    if (!opts.skipHeaders) res.set('Retry-After', after)

                    opts.onRateLimited(req, res, next)
                })

            })
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
