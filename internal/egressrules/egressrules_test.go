package egressrules

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

func TestPathLivesUnderTheDataDir(t *testing.T) {
	dataDir := filepath.Join(t.TempDir(), "data")
	path := Path(dataDir)
	if want := filepath.Join(dataDir, "runtime-support", "egress-rules.cjs"); path != want {
		t.Fatalf("Path = %q, want %q", path, want)
	}
	// A service import replaces artifacts/services wholesale, so rules kept
	// there would be replaced along with the artifact they belong to.
	if strings.Contains(path, "artifacts") {
		t.Fatalf("rules must not live under artifacts: %s", path)
	}
}

func TestEnsureWritesTheEmbeddedRules(t *testing.T) {
	if len(rulesSource) == 0 {
		t.Fatal("the embedded rules are empty")
	}
	dataDir := filepath.Join(t.TempDir(), "data")
	path, err := Ensure(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, rulesSource) {
		t.Fatalf("written rules differs from the embedded one")
	}
	// Ensure creates the data dir itself, because the daemon's own MkdirAll
	// runs after the node check that has to load this file.
	if info, err := os.Stat(dataDir); err != nil || !info.IsDir() {
		t.Fatalf("data dir not created: %v", err)
	}
}

func TestEnsureLeavesAnIdenticalRulesAlone(t *testing.T) {
	dataDir := t.TempDir()
	path, err := Ensure(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	// A distinctive mode proves the second call did not rewrite the file. The
	// write path sets 0644, so 0600 can only survive by not being rewritten.
	if err := os.Chmod(path, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Ensure(dataDir); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("unchanged rules were rewritten: mode %v", info.Mode().Perm())
	}
}

func TestEnsureReplacesAStaleRules(t *testing.T) {
	dataDir := t.TempDir()
	path := Path(dataDir)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("// from an older build\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Ensure(dataDir); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, rulesSource) {
		t.Fatal("rules from another build were left in place")
	}
}

func TestEnsureRejectsAnEmptyDataDir(t *testing.T) {
	if _, err := Ensure(""); err == nil {
		t.Fatal("expected an error for an empty data dir")
	}
}

// rulesReport is what the rules report about the addresses they were asked to
// judge: the reason each refused address is refused, null for each allowed one,
// the same for the addresses of the host running the test, and the reason a
// metadata address is refused by.
type rulesReport struct {
	Denied         []*string `json:"denied"`
	Allowed        []*string `json:"allowed"`
	Own            []*string `json:"own"`
	MetadataReason *string   `json:"metadataReason"`
}

// TestRulesClassifiesAddresses pins the rules themselves, which cannot be seen
// through NODE_OPTIONS: a missing entry would stop refusing an address without
// anything else failing.
//
// The spellings matter as much as the addresses. One address can be written
// several ways, and a rule that compares text refuses some of them.
func TestRulesClassifiesAddresses(t *testing.T) {
	out := runRules(t, `
const os = require('node:os');
const rules = require(process.env.OCTOBUS_TEST_RULES);
const denied = ["127.0.0.1", "127.1.2.3", "::1", "169.254.169.254", "0.0.0.0", "::",
                "fe80::1", "fe80::1%eth0", "::ffff:127.0.0.1", "[::1]",
                "::ffff:7f00:1", "::FFFF:7F00:1", "::ffff:a9fe:a9fe",
                "100.100.100.200", "fd00:ec2::254"].map(a => rules.classify(a));
// The allowed list is the other half of the check: what the product brokers
// must not be refused. Private IPv4 ranges are what instances are configured
// with, and a public address is a normal target.
const allowed = ["10.1.2.3", "192.168.1.5", "172.16.0.1", "8.8.8.8", "example.com",
                 "::ffff:0a01:0203", "2001:db8::1"].map(a => rules.classify(a));
// The host's own address, in both the dotted and the hexadecimal form of its
// IPv4-mapped IPv6 spelling. Empty where the host has no such address.
const own = Object.values(os.networkInterfaces()).flat()
  .filter(e => e.family === "IPv4" && !e.internal).map(e => e.address)
  .flatMap(ip => {
    const h = ip.split(".").map(n => (+n).toString(16).padStart(2, "0"));
    return ["::ffff:" + ip, "::ffff:" + h[0] + h[1] + ":" + h[2] + h[3]].map(a => rules.classify(a));
  });
console.log(JSON.stringify({denied, allowed, own, metadataReason: rules.classify("100.100.100.200")}));
`)
	var rules rulesReport
	if err := json.Unmarshal([]byte(out), &rules); err != nil {
		t.Fatalf("parse rules output %q: %v", out, err)
	}
	for i, reason := range rules.Denied {
		if reason == nil {
			t.Fatalf("refused address %d was allowed", i)
		}
	}
	for i, reason := range rules.Allowed {
		if reason != nil {
			// Private ranges are what this platform brokers; refusing them
			// would refuse the product.
			t.Fatalf("allowed address %d was refused: %s", i, *reason)
		}
	}
	for i, reason := range rules.Own {
		if reason == nil {
			t.Fatalf("the host's own address %d was allowed", i)
		}
	}
	// The reason travels back to whoever wrote the config, so an address must
	// not be reported as something it is not.
	if rules.MetadataReason == nil {
		t.Fatal("a metadata address was allowed")
	}
	if strings.Contains(*rules.MetadataReason, "loopback") {
		t.Fatalf("a metadata address reports the wrong reason: %s", *rules.MetadataReason)
	}
}

// TestRulesRefusesDeniedDestinationsAndAllowsPrivateOnes exercises the patches
// rather than the rules: a literal loopback address (which no lookup sees), a
// name that resolves to one (which only the lookup sees), and an address that
// must still go through.
//
// Every refusal has to arrive as an error the caller can handle — a rejected
// promise, or an 'error' event on the socket it asked for — never as an
// exception thrown out of the call. A synchronous throw escapes a caller that
// handles errors with .catch or .on('error'), which is how the SDKs here are
// written, and takes the runtime down with it.
//
// Every refusal also needs the case it must not catch: a private address, a
// port written as a string, the object form of an option. A check that is too
// wide passes every test that only names addresses to refuse.
func TestRulesRefusesDeniedDestinationsAndAllowsPrivateOnes(t *testing.T) {
	out := runRules(t, `
const http = require('node:http');
const net = require('node:net');
const tls = require('node:tls');
const detail = (e) => String((e && e.cause && e.cause.code) || (e && e.code) || (e && e.name));
const attempt = async (url) => {
  try { await fetch(url, { signal: AbortSignal.timeout(1500) }); return "open"; }
  catch (e) { return detail(e); }
};
// A refusal has to reach the socket's 'error' handler. A synchronous throw is
// reported as such, so the test can tell the two apart.
const dial = (make) => new Promise((resolve) => {
  let socket;
  try { socket = make(); } catch (e) { resolve("threw:" + detail(e)); return; }
  const finish = (value) => { socket.destroy(); resolve(value); };
  socket.on("error", (e) => finish(detail(e)));
  setTimeout(() => finish("no-error"), 1500);
});
// A lookup the caller supplied is what Node uses instead of dns.lookup, and it
// answers with this host's own loopback.
const ownLookup = (hostname, options, callback) => {
  if (typeof options === "function") return options(null, "127.0.0.1", 4);
  return (options && options.all)
    ? callback(null, [{ address: "127.0.0.1", family: 4 }])
    : callback(null, "127.0.0.1", 4);
};
(async () => {
  // The caller's options object is theirs. Using it for several connections
  // must leave it unchanged and must not add another layer each time, and a
  // frozen one must be refused like any other rather than throwing.
  Error.stackTraceLimit = Infinity;
  const layers = [];
  const callerLookup = (hostname, options, callback) => {
    layers.push(new Error().stack.split("\n").filter((line) => line.includes("checkedLookup")).length);
    return (options && options.all)
      ? callback(null, [{ address: "127.0.0.1", family: 4 }])
      : callback(null, "127.0.0.1", 4);
  };
  const reused = { host: "example.test", port: 80, lookup: callerLookup };
  for (let i = 0; i < 5; i++) await dial(() => net.connect(reused));
  // Options whose host and port live on a prototype, which copying own
  // properties would drop.
  class PrototypeOptions {
    constructor() { this.lookup = callerLookup; }
    get host() { return "10.1.2.3"; }
    get port() { return 80; }
  }
  let prototypeOptions = "ok";
  try {
    const socket = net.connect(new PrototypeOptions());
    socket.on("error", () => {});
    socket.destroy();
  } catch (e) { prototypeOptions = "threw:" + detail(e); }
  console.log(JSON.stringify({
    prototypeOptions,
    reuseKept: reused.lookup === callerLookup ? "yes" : "no",
    reuseLayers: String(Math.max(...layers)),
    frozen: await dial(() => net.connect(Object.freeze({ host: "127.0.0.1", port: 80, lookup: callerLookup }))),
    literal: await attempt("http://127.0.0.1:80/"),
    name: await attempt("http://localhost:80/"),
    private_: await attempt("http://10.255.255.1:80/"),
    connect: await dial(() => net.connect({ host: "127.0.0.1", port: 80 })),
    createConnection: await dial(() => net.createConnection({ host: "127.0.0.1", port: 80 })),
    socketOptions: await dial(() => new net.Socket().connect({ host: "127.0.0.1", port: 80 })),
    socketArguments: await dial(() => new net.Socket().connect(80, "127.0.0.1")),
    suppliedLookup: await dial(() => net.connect({ host: "example.test", port: 80, lookup: ownLookup })),
    suppliedLookupSocket: await dial(() => new net.Socket().connect({ host: "example.test", port: 80, lookup: ownLookup })),
    httpGet: await new Promise((resolve) => {
      try { http.get("http://127.0.0.1:80/").on("error", (e) => resolve(detail(e))); }
      catch (e) { resolve("threw:" + detail(e)); }
    }),
    // A caller that resolves a name itself, through the promise API.
    promisesLookup: await process.getBuiltinModule("node:dns").promises.lookup("localhost")
      .then(() => "resolved", (e) => detail(e)),
    // Unix sockets are destinations too, and a local one. Without the rules
    // these fail with ENOENT, so the code tells the two apart.
    socketPath: await dial(() => net.connect({ path: "/tmp/octobus-rules-test.sock" })),
    socketPathArguments: await dial(() => net.connect("/tmp/octobus-rules-test.sock")),
    socketPathOnSocket: await dial(() => new net.Socket().connect({ path: "/tmp/octobus-rules-test.sock" })),
    socketPathViaHttp: await new Promise((resolve) => {
      try { http.get({ socketPath: "/tmp/octobus-rules-test.sock", path: "/" }).on("error", (e) => resolve(detail(e))); }
      catch (e) { resolve("threw:" + detail(e)); }
    }),
    abstractSocket: await dial(() => net.connect({ path: "\0octobus-rules-test" })),
    // A port given as a string is a port, not a socket path, and the positional
    // form of connect is how some clients pass one. Whatever happens to this
    // connection, it must not be the rules refusing it.
    numericStringPort: await dial(() => net.connect("5432", "10.255.255.1")),
    // tls.connect has no patch of its own; it is refused by the socket it
    // connects, which is also what keeps the socket a TLSSocket.
    tlsConnect: await new Promise((resolve) => {
      let socket;
      try { socket = tls.connect({ host: "127.0.0.1", port: 80 }); }
      catch (e) { resolve("threw:" + detail(e)); return; }
      socket.on("error", (e) => resolve(detail(e) + ":" + (socket instanceof tls.TLSSocket ? "TLSSocket" : "plain")));
      setTimeout(() => resolve("no-error"), 1500);
    }),
  }));
})();
`)
	var results map[string]string
	if err := json.Unmarshal([]byte(out), &results); err != nil {
		t.Fatalf("parse rules output %q: %v", out, err)
	}
	for _, key := range []string{"literal", "name", "connect", "createConnection", "socketOptions", "socketArguments", "suppliedLookup", "suppliedLookupSocket", "frozen", "httpGet", "promisesLookup", "socketPath", "socketPathArguments", "socketPathOnSocket", "socketPathViaHttp", "abstractSocket"} {
		if results[key] != "ERR_OCTOBUS_EGRESS_BLOCKED" {
			t.Fatalf("%s destination = %q, want the rules error reported as an error, not thrown", key, results[key])
		}
	}
	if results["reuseKept"] != "yes" {
		t.Fatal("the caller's options object was modified")
	}
	if results["prototypeOptions"] != "ok" {
		t.Fatalf("options with a prototype were rejected: %s", results["prototypeOptions"])
	}
	// One check per connection: a second layer would mean the object is being
	// wrapped again, which on a client that reuses one options object grows
	// until a lookup overflows the stack.
	if results["reuseLayers"] != "1" {
		t.Fatalf("a reused options object nested %s checks deep, want 1", results["reuseLayers"])
	}
	// A refused tls.connect hands back the TLSSocket its caller expects.
	if results["tlsConnect"] != "ERR_OCTOBUS_EGRESS_BLOCKED:TLSSocket" {
		t.Fatalf("tls.connect = %q, want the rules error on a TLSSocket", results["tlsConnect"])
	}
	// The positive control: a private address is a normal destination here, so
	// whatever happens to the connection, it must not be the rules refusing it.
	if results["private_"] == "ERR_OCTOBUS_EGRESS_BLOCKED" {
		t.Fatal("a private address was refused; that would refuse the product")
	}
	// A port written as a string is a port, which some clients pass in the
	// positional form.
	if results["numericStringPort"] == "ERR_OCTOBUS_EGRESS_BLOCKED" {
		t.Fatal("a numeric string port was refused; that is a TCP destination")
	}
}

// runRules loads the rules the way a runtime does — --require, under the
// permission model, with the read grant hardening gives it — and returns what
// the script printed. Loading it under --permission is part of the test: a
// rules the permission model refuses to load takes every runtime with it.
// TestRulesCheckASuppliedLookupInTheNormalizedArguments covers the path taken
// when net.connect's own patch is not in the way: net.connect normalizes its
// arguments into an array and hands that array to the socket, and the array
// carries a marker the native connect needs. Rebuilding it instead of filling it
// in loses that marker, and the connection then fails with a different error —
// one thrown out of the call rather than reported to the caller.
func TestRulesCheckASuppliedLookupInTheNormalizedArguments(t *testing.T) {
	out := runRulesScriptWithoutPreload(t, `
const net = require("node:net");
const nativeConnect = net.connect;
require(process.env.OCTOBUS_TEST_RULES);
const detail = (e) => String((e && e.cause && e.cause.code) || (e && e.code) || (e && e.name));
// A lookup that answers with this host's own loopback, on a connect whose
// arguments net.connect normalized before the socket saw them.
const lookup = (hostname, options, callback) => (options && options.all)
  ? callback(null, [{ address: "127.0.0.1", family: 4 }])
  : callback(null, "127.0.0.1", 4);
(async () => {
  const viaNormalizedArguments = await new Promise((resolve) => {
    let socket;
    try { socket = nativeConnect({ host: "example.test", port: 80, lookup }); }
    catch (e) { resolve("threw:" + detail(e)); return; }
    socket.on("error", (e) => resolve(detail(e)));
    setTimeout(() => { socket.destroy(); resolve("no-error"); }, 1500);
  });
  console.log(JSON.stringify({ viaNormalizedArguments }));
})();
`)
	var results map[string]string
	if err := json.Unmarshal([]byte(out), &results); err != nil {
		t.Fatalf("parse rules output %q: %v", out, err)
	}
	if results["viaNormalizedArguments"] != "ERR_OCTOBUS_EGRESS_BLOCKED" {
		t.Fatalf("a supplied lookup in normalized arguments = %q, want the rules error reported as an error", results["viaNormalizedArguments"])
	}
}

// TestRulesReportARefusalOnce pins the one trace a refusal leaves. Nothing else
// shows it: the audit records the call as allowed and the runtime writes nothing
// of its own, so without this line an operator cannot tell that a destination
// was refused. It names the reason and not the address, and repeats are dropped
// so a service that keeps trying cannot fill its own log.
//
// The script silences both console.error and process.stderr.write first, as a
// service may, and the lines are read from the process's real stderr: the line
// has to arrive there regardless.
func TestRulesReportARefusalOnce(t *testing.T) {
	_, stderr := runRulesWithStderr(t, `
console.error = () => {};
process.stderr.write = () => true;
const net = require("node:net");
// Three refusals of one reason, one of another, one on the path a fetch takes.
for (let i = 0; i < 3; i++) { net.connect({ host: "127.0.0.1", port: 80 }).on("error", () => {}); }
net.connect({ host: "169.254.169.254", port: 80 }).on("error", () => {});
net.connect({ path: "/tmp/octobus-rules-test.sock" }).on("error", () => {});
(async () => {
  try { await fetch("http://127.0.0.1:80/"); } catch {}
  console.log("done");
})();
`)
	// Compared against RefusalMarker, the string the daemon looks for, rather
	// than a second copy of it: a drift between rules.cjs and the constant
	// leaves no matching line and has to fail here. Other lines are node's own
	// warnings, which are not the rules' to report.
	var lines []string
	for _, line := range strings.Split(stderr, "\n") {
		if strings.HasPrefix(line, RefusalMarker) {
			lines = append(lines, line)
		}
	}
	if len(lines) < 2 {
		t.Fatalf("refusals reported %d lines, want one per reason: %q", len(lines), stderr)
	}
	seen := map[string]bool{}
	for _, line := range lines {
		if seen[line] {
			t.Fatalf("a reason was reported more than once: %q", lines)
		}
		seen[line] = true
	}
	address := regexp.MustCompile(`\d+\.\d+\.\d+\.\d+|::1`)
	for _, line := range lines {
		if address.MatchString(line) {
			t.Fatalf("a refusal names the address it was given: %q", line)
		}
	}
}

// runRules loads the rules with --require, the way a runtime does, and returns
// what the script printed.
func runRules(t *testing.T, script string) string {
	t.Helper()
	out, _ := runRulesScript(t, script, true)
	return out
}

// runRulesWithStderr is runRules, also returning what the script wrote to its
// real stderr, where the rules report a refusal.
func runRulesWithStderr(t *testing.T, script string) (string, string) {
	t.Helper()
	return runRulesScript(t, script, true)
}

// runRulesScriptWithoutPreload runs a script that loads the rules itself, which
// a test needs when it has to keep a function the rules replace.
func runRulesScriptWithoutPreload(t *testing.T, script string) string {
	t.Helper()
	out, _ := runRulesScript(t, script, false)
	return out
}

func runRulesScript(t *testing.T, script string, preload bool) (string, string) {
	t.Helper()
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not installed")
	}
	if out, err := exec.Command(node, "--version").Output(); err != nil {
		t.Skipf("node --version: %v", err)
	} else if !supportedNode(strings.TrimSpace(string(out))) {
		t.Skipf("node %s does not support --permission", strings.TrimSpace(string(out)))
	}
	dataDir := t.TempDir()
	path, err := Ensure(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	// The flags mirror what hardening generates: both path forms granted, and
	// node told to load the resolved one. A raw path here fails on hosts where
	// an ancestor is a symlink (/var and /tmp on macOS), because requiring a
	// file walks its ancestors and the permission model refuses that walk.
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		t.Fatal(err)
	}
	options := "--permission --allow-fs-read=" + quote(path) + " --allow-fs-read=" + quote(resolved)
	if preload {
		options += " --require=" + quote(resolved)
	}
	cmd := exec.Command(node, "-e", script)
	cmd.Env = append(os.Environ(),
		"NODE_OPTIONS="+options,
		// The resolved path again: the script requires this to read the rules,
		// and requiring the unresolved form walks the same symlinked ancestors.
		"OCTOBUS_TEST_RULES="+resolved,
	)
	// stdout is parsed on its own, so anything the rules print there fails the
	// test instead of being skipped over. stderr is returned separately; node
	// writes its own warnings there too.
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("rules script failed: %v\nstdout: %s\nstderr: %s", err, out, stderr.String())
	}
	return strings.TrimSpace(string(out)), stderr.String()
}

// supportedNode reports whether node is new enough for the stable --permission
// flag, mirroring what hardening accepts. It is spelled out here rather than
// imported so this package's tests do not depend on the package that will call
// it.
func supportedNode(version string) bool {
	trimmed := strings.TrimPrefix(version, "v")
	majorText, rest, ok := strings.Cut(trimmed, ".")
	if !ok {
		return false
	}
	minorText, _, _ := strings.Cut(rest, ".")
	major, errMajor := strconv.Atoi(majorText)
	minor, errMinor := strconv.Atoi(minorText)
	if errMajor != nil || errMinor != nil {
		return false
	}
	return major >= 24 || (major == 23 && minor >= 5) || (major == 22 && minor >= 13)
}

// quote mirrors the quoting hardening applies to NODE_OPTIONS values.
func quote(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `"`, `\"`)
	return `"` + value + `"`
}
