'use strict';

// Egress restrictions for service runtimes, loaded with `--require` at the
// `node` hardening level.
//
// A runtime's destination comes from its instance config, and it dials that
// address on the runtime's own network rather than the config author's.
// Destinations only the runtime's host can reach — a loopback or link-local
// address, an address of the host itself, or a unix socket path — are not where
// a service lives, so they are refused.
//
// Loopback does not leave the host, so the check runs in the process that dials
// rather than at the network edge.

const dns = require('node:dns');
const net = require('node:net');
const os = require('node:os');

const BLOCKED_CODE = 'ERR_OCTOBUS_EGRESS_BLOCKED';

// 0.0.0.0/8 and :: look inert, but connecting to the unspecified address
// reaches loopback on Linux, so they are refused as well.
//
// Every address here is held in a BlockList rather than compared as text. One
// address has many spellings — IPv4-mapped, upper case, a shortened or expanded
// form — and a string comparison refuses some of them and lets the rest pass.
const denied = new net.BlockList();
denied.addSubnet('0.0.0.0', 8, 'ipv4');
denied.addSubnet('127.0.0.0', 8, 'ipv4');
denied.addSubnet('169.254.0.0', 16, 'ipv4');
denied.addAddress('::', 'ipv6');
denied.addAddress('::1', 'ipv6');
denied.addSubnet('fe80::', 10, 'ipv6');

// Metadata services that answer outside the link-local range: Alibaba Cloud's
// over IPv4 and AWS's over IPv6. The endpoints are named rather than their
// ranges refused, because those ranges hold ordinary private destinations —
// fd00::/8 is to IPv6 what RFC1918 is to IPv4 — and this platform reaches
// private addresses by design.
const metadata = new net.BlockList();
metadata.addAddress('100.100.100.200', 'ipv4');
metadata.addAddress('fd00:ec2::254', 'ipv6');

// The non-loopback addresses of the host this runtime runs on. A runtime calls
// the service its instance names, which is never an address of the host it is
// running on.
const ownAddresses = new net.BlockList();
for (const entries of Object.values(os.networkInterfaces())) {
  for (const entry of entries || []) {
    if (entry.internal) continue;
    const family = net.isIP(entry.address);
    if (family !== 0) ownAddresses.addAddress(entry.address, family === 6 ? 'ipv6' : 'ipv4');
  }
}

// Returns the reason address is refused, or null when it is allowed.
function classify(address) {
  if (typeof address !== 'string') return null;
  let value = address;
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1); // a URL host
  const scoped = value.indexOf('%'); // a scope suffix, as in fe80::1%eth0
  if (scoped !== -1) value = value.slice(0, scoped);
  const family = net.isIP(value);
  if (family === 0) return null;
  const type = family === 6 ? 'ipv6' : 'ipv4';
  if (denied.check(value, type)) return 'loopback, link-local, or unspecified address';
  if (metadata.check(value, type)) return 'a metadata service address';
  if (ownAddresses.check(value, type)) return "this host's own address";
  return null;
}

// Names the reason and not the address: the reason is what a config author
// needs to correct it, and the address is this network's own resolution of a
// name they chose.
//
// Every refusal is built here, so this is also where one is reported. The
// caller sees the error, and nothing else would show that a destination was
// refused at all: the audit records the call as allowed, and the runtime writes
// nothing of its own. One line per reason per process puts a blocked attempt
// where an operator can find it, without letting a service that keeps trying
// fill its log.
//
// Written through the stream's own write, taken here while the rules load and
// before any service code runs: console and process.stderr.write are both
// globals a service can replace later, and the one line an operator relies on
// should not be the line a service can silence.
const writeStderr = process.stderr.write.bind(process.stderr);
const reportedReasons = new Set();
function denyError(reason) {
  if (!reportedReasons.has(reason)) {
    reportedReasons.add(reason);
    writeStderr(`egress refused: ${reason}\n`);
  }
  const error = new Error(`egress to ${reason} is not allowed`);
  error.code = BLOCKED_CODE;
  return error;
}

// Hands back the socket the caller asked for, failed on the next tick. A
// refused connection has to look like any other failed one, reported through
// 'error' so it reaches the caller's handler. Throwing instead would escape a
// handler that does not wrap the call in try/catch, and take a long-running
// runtime down over a single request.
function denySocket(socket, reason) {
  process.nextTick(() => socket.destroy(denyError(reason)));
  return socket;
}

// With more than one answer the whole lookup is refused, so a name resolving to
// both an allowed and a refused address is not usable.
function firstDenied(addresses) {
  for (const entry of addresses) {
    const address = typeof entry === 'string' ? entry : entry && entry.address;
    const reason = classify(address);
    if (reason) return reason;
  }
  return null;
}

// dns.lookup judges a name at the address the connection uses, which also
// covers every redirect hop and leaves no second resolution to disagree with
// the first. A literal is passed through: lookup serves binding as well as
// dialling, and a server asked to listen on 127.0.0.1 resolves it this way.
const lookup = dns.lookup;
dns.lookup = function patchedLookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (typeof hostname !== 'string' || net.isIP(hostname) !== 0) {
    return lookup.call(this, hostname, options, callback);
  }
  return lookup.call(this, hostname, options, function patched(err, address, family) {
    if (err) return callback(err, address, family);
    const reason = firstDenied(Array.isArray(address) ? address : [address]);
    if (reason) return callback(denyError(reason));
    return callback(null, address, family);
  });
};

const promisesLookup = dns.promises.lookup;
dns.promises.lookup = async function patchedLookup(hostname, options) {
  const result = await promisesLookup.call(this, hostname, options);
  if (typeof hostname !== 'string' || net.isIP(hostname) !== 0) {
    return result;
  }
  const reason = firstDenied(Array.isArray(result) ? result : [result]);
  if (reason) throw denyError(reason);
  return result;
};

// fetch judges a literal address in a URL, which no lookup sees. A refusal is a
// rejected promise rather than a throw, because that is what fetch does with
// every other failure and a throw would escape a caller's .catch.
//
// input and init are forwarded untouched: callers pass a dispatcher and an
// AbortSignal whose identity they rely on.
const fetchImpl = globalThis.fetch;
if (typeof fetchImpl === 'function') {
  globalThis.fetch = function patchedFetch(input, init) {
    const target = typeof input === 'string' || input instanceof URL ? String(input) : input && input.url;
    if (typeof target === 'string') {
      let url;
      try {
        url = new URL(target);
      } catch {
        return fetchImpl.call(this, input, init); // not a URL this can judge
      }
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        if (url.username || url.password) {
          return Promise.reject(denyError('a URL carrying credentials'));
        }
        const reason = classify(url.hostname);
        if (reason) return Promise.reject(denyError(reason));
      }
    }
    return fetchImpl.call(this, input, init);
  };
}

// A caller can supply its own lookup, and Node then calls that instead of
// dns.lookup — a caching resolver, or an Agent built with one. Judging what it
// returns keeps that from being a way to reach an address the lookup check
// never sees.
//
// The check goes into a copy of the options, and a lookup that already carries
// the mark is left alone. The options object belongs to the caller, who may
// reuse it for every reconnect and may have frozen it: replacing its lookup in
// place would nest one wrapper deeper per connection, and a client that keeps
// one options object would eventually overflow the stack inside a lookup.
const CHECKED_LOOKUP = Symbol('octobus.egressRules.checkedLookup');
function withCheckedLookup(options) {
  const inner = options && typeof options === 'object' ? options.lookup : null;
  if (typeof inner !== 'function' || inner[CHECKED_LOOKUP]) return null;
  const checked = function checkedLookup(hostname, lookupOptions, callback) {
    if (typeof lookupOptions === 'function') {
      callback = lookupOptions;
      lookupOptions = {};
    }
    return inner.call(this, hostname, lookupOptions, function (err, address, family) {
      if (err) return callback(err, address, family);
      const reason = firstDenied(Array.isArray(address) ? address : [address]);
      if (reason) return callback(denyError(reason));
      return callback(null, address, family);
    });
  };
  checked[CHECKED_LOOKUP] = true;
  // A copy whose prototype is the caller's object, so every other property
  // still reads through — including one defined on a prototype or as a getter,
  // which copying own properties would drop. Only lookup is replaced.
  return Object.create(options, {
    lookup: { value: checked, enumerable: true, writable: true, configurable: true },
  });
}

// The reason the address this connect would use is refused, or null. A name is
// left to dns.lookup; a lookup the caller supplied is checked on the way past.
//
// It also puts the checked lookup into the arguments, so what the native
// connect receives carries it. That is the only thing it changes.
//
// net.connect normalizes its arguments and hands the socket a single array
// holding them, so the arguments may be that array rather than the call's own.
function checkConnect(args) {
  let rest = args;
  let first = args[0];
  if (Array.isArray(first)) {
    rest = first;
    first = first[0];
  }
  let host;
  let options = null;
  // A string is a socket path or a port, by the same test Node makes: a string
  // that is not a number is a path, and a numeric one is a port. A port is
  // often a string, because it came from a config or an environment variable,
  // and connect("5432", host) is an ordinary TCP destination.
  if (typeof first === 'string' && !(Number(first) >= 0)) {
    return 'a unix socket';
  }
  if (first !== null && typeof first === 'object') {
    // A socket path is a local destination like any other, and the permission
    // model does not stand in for this check: --allow-fs-read governs reading
    // files, not connecting to a socket file. The daemon reaches a runtime over
    // TCP and its standard streams, so a runtime has no socket to call.
    if (first.path) return 'a unix socket';
    host = first.host;
    options = first;
  } else {
    host = rest[1];
    if (rest[2] !== null && typeof rest[2] === 'object') options = rest[2]; // connect(port, host, options)
  }
  const checked = withCheckedLookup(options);
  if (checked !== null) {
    if (rest !== args) {
      // In place: the array net.connect hands over carries a marker the native
      // connect needs, and a rebuilt one does not have it.
      rest[0] = checked;
    } else if (options === first) {
      args[0] = checked;
    } else {
      args[2] = checked;
    }
  }
  if (typeof host !== 'string' || host === '') return null;
  if (net.isIP(host) === 0) return null; // a name; dns.lookup judges it
  return classify(host);
}

const connect = net.connect;
const checkedConnect = function patchedConnect(...args) {
  const reason = checkConnect(args);
  if (reason) return denySocket(new net.Socket(), reason);
  return connect.apply(this, args);
};
net.connect = checkedConnect;
// The same function under another name, and callers use both.
net.createConnection = checkedConnect;

// tls.connect needs no patch of its own: it connects a TLSSocket, which
// arrives at net.Socket.prototype.connect below with the host in its options.
// Denying it there also hands back a real TLSSocket, which is what a caller of
// tls.connect has in hand.

// net.Socket.prototype.connect is where a socket built by hand lands:
// `new net.Socket().connect(port, host)` does not go through the functions
// above, and a literal address has no lookup to judge either. It returns the
// socket, so a refusal has to as well.
const socketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function patchedSocketConnect(...args) {
  const reason = checkConnect(args);
  if (reason) return denySocket(this, reason);
  return socketConnect.apply(this, args);
};

// Exported for the tests, which judge addresses through classify alone.
module.exports = { classify };
