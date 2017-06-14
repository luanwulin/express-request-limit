'use strict';

const _ = require('lodash');

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
        let extra = this['method'].toLowerCase() == 'post' ? this.req.body : this.req.query;
        return key + JSON.stringify(extra);
    }

    afterSet(callback, value) {
        let args = arguments.slice(1);

        if (callback) {
            return callback.apply(null, args);
        } else {
            return Promise.resolve.apply(Promise, args);
        }
    }

    afterGet(callback, value) {
        let args = arguments.slice(1);

        if (callback) {
            return callback.apply(null, args);
        } else {
            return Promise.resolve.apply(Promise, args);
        }
    }

    filterValue (value){
        return JSON.stringify(value);
    }
}

class Session extends Store {
    constructor(opts) {
        super(opts)
    }

    set(key, value, lifetime, callback) {
        let req = this.req;
        let key = this.getKey(key);
        let oldMaxAge = req.session.cookie.maxAge;

        req.session.cookie.maxAge = lifetime;
        req.session[key] = this.filterValue(value);

        req.session.cookie.maxAge = oldMaxAge;

        return this.afterSet(callback, undefined);
    }

    get(key, callback) {
        let req = this.req;
        let key = this.getKey(key);
        let value = req.session[key];

        return this.afterGet(callback, undefined, value);
    }
}

class Cookie extends Store {
    constructor(opts) {
        super(opts)
    }

    set(key, value, lifetime, callback) {
        let res = this.res;
        let key = this.getKey(key);

        res.cookie(key, this.filterValue(value), {expires: lifetime, httpOnly: true});

        return this.afterSet(callback, undefined);
    }

    get(key, callback) {
        let req = this.req;
        let key = this.getKey(key);
        let value = req.cookies[key];

        return this.afterGet(callback, undefined, value);
    }
}

class Redis extends Store {
    constructor(opts) {
        super(opts)
    }

    set(key, value, lifetime, callback) {
        let key = this.getKey(key);
        let db = this.db;

        return db.set(key, this.filterValue(value), this.per || 'PX', lifetime).then(e => {
            return this.afterSet(callback, e)
        });
    }

    get(key, callback) {
        let key = this.getKey(key);
        let db = this.db;

        return db.get(key).then((e, value) => {
            return this.afterGet(callback, e, value);
        })
    }
}


module.exports.Session = Session;
module.exports.Cookie = Cookie;
module.exports.Redis = Redis;