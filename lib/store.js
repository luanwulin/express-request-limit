'use strict';

const _ = require('lodash');

const slice = Array.prototype.slice;

class Store {
    constructor(opts) {

    }

    refresh(opts) {
        _.extend(this, opts);
    }

    set() {
        throw new Error('to be implemented')
    }

    get() {
        throw new Error('to be implemented')
    }

    getKey(key) {
        let method = (opts.method || req.method).toLowerCase();
        let extra = method.toLowerCase() == 'post' ? this.req.body : this.req.query;
        return key + JSON.stringify(extra);
    }

    afterSet(callback, value) {
        let args = slice.call(arguments, 1);

        if (callback) {
            return callback.apply(null, args);
        } else {
            return Promise.resolve.apply(Promise, args);
        }
    }

    afterGet(callback, value) {
        let args = slice.call(arguments, 1);

        if (callback) {
            return callback.apply(null, args);
        } else {
            return Promise.resolve.apply(Promise, args);
        }
    }

    filterValue(value) {
        return JSON.stringify(value);
    }

    filterRet(value) {
        return value ? value : null;
    }
}

class Session extends Store {
    constructor(opts) {
        super(opts)
    }

    set(key, value, lifetime, callback) {
        let req = this.req;
        key = this.getKey(key);
        let oldMaxAge = req.session.cookie.maxAge;

        req.session.cookie.maxAge = lifetime;
        req.session[key] = this.filterValue(value);

        req.session.cookie.maxAge = oldMaxAge;

        return this.afterSet(callback, undefined);
    }

    get(key, callback) {
        let req = this.req;
        key = this.getKey(key);
        let value = req.session[key];

        return this.afterGet(callback, undefined, this.filterRet(value));
    }
}

class Cookie extends Store {
    constructor(opts) {
        super(opts)
    }

    set(key, value, lifetime, callback) {
        let res = this.res;
        key = this.getKey(key);

        let conf = {
            maxAge: lifetime,
            httpOnly: this.httpOnly,
            path: this.path ? this.path : '/',
            secure: this.secure || false,
            signed: this.signed || false
        }

        this.domain && _.extend(conf.domain, {domain: this.domain})
        res.cookie(key, this.filterValue(value), conf);

        return this.afterSet(callback, undefined);
    }

    get(key, callback) {
        let req = this.req;
        key = this.getKey(key);
        let value = req.cookies[key];

        return this.afterGet(callback, undefined, this.filterRet(value));
    }
}

class Redis extends Store {
    constructor(opts) {
        super(opts)
    }

    set(key, value, lifetime, callback) {
        key = this.getKey(key);
        let db = this.client;

        return db.set(key, this.filterValue(value), this.per || 'PX', lifetime, e => {
            return this.afterSet(callback, e)
        });
    }

    get(key, callback) {
        key = this.getKey(key);
        let db = this.client;

        return db.get(key, (e, value) => {
            return this.afterGet(callback, e, this.filterRet(value));
        })
    }
}


module.exports.Session = Session;
module.exports.Cookie = Cookie;
module.exports.Redis = Redis;