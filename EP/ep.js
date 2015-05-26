var PENDING = 'pending';
var FULFILLED = 'fulfiled';
var REJECTED = 'rejected';

function isThenable(obj) {
	return obj && obj.then && isFn(obj.then);
}

function isFn(fn) {
	return typeof fn === 'function';
}

var EP = function(resolver) {
	if (!(this instanceof EP)) {
		return new EP(resolver);
	}

	var ep = this;
	// ep._value = null;
	// ep._reason = null;
	ep._status = PENDING;
	ep._resolves = [];
	ep._rejects = [];

	isFn(resolver) && resolver(this.resolve.bind(this), this.reject.bind(this));
};

EP.resolve = function(arg) {
	var ep = new EP();

	if (isThenable(arg)) {
		return resolveThen(ep, arg);
	} else {
		return ep.resolve(arg);
	}
};

EP.reject = function(arg) {
	var ep = new EP();
	ep.reject(arg);
	
	return ep;
};

EP.prototype.then = function(onFulfilled, onRejected) {
	var next = this._next || (this._next = EP()); // 形成链式引用，将promise关联起来
	var status = this._status;
	var v;

	if (PENDING === status) {
		// pending 状态直接将回调压入栈中
		isFn(onFulfilled) && this._resolves.push(onFulfilled);
		isFn(onRejected) && this._rejects.push(onRejected);
	} else if (FULFILLED === status) {
		// 如果是fulfilled 状态
		if (!isFn(onFulfilled)) {
			next.resolve(onFulfilled);
		} else {
			try {
				v = onFulfilled(this._value);
				resolveV(next, v);
			} catch (e) {
				this.reject(e);
			}
		}
	} else if (REJECTED === status) {
		if (!isFn(onRejected)) {
			next.reject(onRejected);
		} else {
			try {
				v = onRejected(this._reason);
				resolveV(next, v);
			} catch (e) {
				this.reject(e);
			}
		}
	}

	return next;
};

EP.prototype.resolve = function(value) {
	if (REJECTED === this._status) {
		throw new Error('can not call this method when the status is rejected');
	}

	this._status = FULFILLED;
	this._value = value;
	this._resolves.length && fireAll(this);

	return this;
};

EP.prototype.reject = function(reason) {
	if (FULFILLED === this._status) {
		throw new Error('can not call this method when the status is fulfuilled');
	}

	this._status = REJECTED;
	this._rejects.length && fireAll(this);

	return this;
};

// 语法糖
EP.prototype.catch = function(onRejected) {
	return this.then(void 0, onRejected);
};

/**
 * [all 接收一个promise对象数组]
 * @param  {[type]} promises
 * @return {[type]}
 */
EP.prototype.all = function(promises) {
	var len = promises.length,
		ep = new EP(), // 用于返回的新promise对象
		v = [], // 返回结果
		pending = 0, // 表示当前执行完成的个数
		locked;

	for (var i = 0; i < len; i++) {
		promises[i].then(function(val) {
			v[i] = val; // 将返回值正确的塞进数组
			pending++; // 计数器++

			if (!lock && len === pending) {
				ep.resolve(v);
			}
		}).catch(function(reason) {
			locked = true; // 执行reject
			ep.reject(reason);
		});
	}

	return ep;
};

EP.prototype.any = function(promises) {
	var ep = new EP(),
		flag;

	for (var i = 0, l = promises.length; i < l; i++) {
		promises[i].then(function(v) {
			if (!flag) {
				flag = true;
				ep.resolve(v);
			}
		}).catch(function(reason) {
			flag = true;
			ep.reject(reason);
		});
	}
};

function fireAll(ep) {
	var status = ep._status;
	var queue = ep[FULFILLED === status ? '_resolves' : '_rejects'];
	var arg = ep[FULFILLED === status ? '_value' : '_reason'];
	var fn;
	var v;

	while (fn = queue.shift()) { // 按照队列的思想，先进先出，保持了then链的执行顺序
		v = fn.call(ep, arg) || arg;
		resolveV(ep._next, v); // 对返回的值进行分类处理
	}

	return ep;
}

function resolveV(ep, v) {
	if (ep === v) {
		ep.reject(new Error('TypeError'));
	}

	if (v instanceof EP) {
		// 如果上一步的返回值是一个Promise对象，那么需要等这个Promise对象的状态变化后才能继续执行
		return resolvePromise(ep, v);
	} else if (isThenable(v)) {
		// 如果是一个thenable对象特殊处理
		return resolveThen(ep, v);
	} else {
		// 普通的返回值直接进行递归调用就ok
		return ep.resolve(v);
	}
}

function resolvePromise(ep1, ep2) {
	var status = ep2._status;

	if (PENDING === status) {
		ep2.then(ep1.resolve.bind(ep1), ep1.reject.bind(ep2));
	} else if (FULFILLED === status) {
		ep1.resolve(ep2._value);
	} else if (REJECTED === status) {
		ep1.reject(ep2._reason);
	}

	return ep1;
}

function resolveThen(ep, thenable) {
	var flag = false;
	var resolve = once(function(v) {
		if (flag) {
			return;
		}

		resolveV(ep, v);

		flag = true;
	});

	var reject = once(function(v) {
		if (flag) {
			return;
		}

		promise.reject(v);
		flag = true;
	});

	try {
		thenable.then.call(thenable, resolve, reject);
	} catch (e) {
		if (!flag) {
			throw e;
		} else {
			ep.reject(e);			
		}
	}

	return ep;
}

// 保证只执行一次函数
function once(fn) {
	var called = false;
	var v;

	return function() {
		if (called) {
			return v;
		}
		called = true;

		return v = fn.apply(this, arguments);
	};
}
