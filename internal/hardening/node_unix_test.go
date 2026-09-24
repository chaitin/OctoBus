//go:build !windows

package hardening

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// fakeNode puts a node on PATH that reports version and runs script for any
// other invocation.
func fakeNode(t *testing.T, version, script string) {
	t.Helper()
	dir := t.TempDir()
	body := "#!/bin/sh\nif [ \"$1\" = --version ]; then\n" +
		"  if [ -n \"${NODE_OPTIONS+x}\" ]; then echo \"version query inherited NODE_OPTIONS\" >&2; exit 1; fi\n" +
		"  echo " + version + "; exit 0\nfi\n" + script + "\n"
	if err := os.WriteFile(filepath.Join(dir, "node"), []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
}

func TestCheckNodeRejectsNodeThatFailsWithRuntimeOptions(t *testing.T) {
	// A version that passes the check but refuses the flags, as Node.js 24
	// does for --allow-net in NODE_OPTIONS.
	fakeNode(t, "v25.0.0", `echo "node: --allow-net is not allowed in NODE_OPTIONS" >&2; exit 9`)
	_, err := CheckNode(context.Background())
	if err == nil || !strings.Contains(err.Error(), "--allow-net is not allowed") {
		t.Fatalf("CheckNode = %v, want the probe failure", err)
	}
}

func TestCheckNodeProbesWithRuntimeOptions(t *testing.T) {
	// The probe must run the way a runtime runs: runtime flags including
	// quoted directory grants, the filtered environment with HOME in the
	// workdir, and the workdir as cwd. None of the caller's NODE_OPTIONS or
	// other variables may reach it.
	t.Setenv("NODE_OPTIONS", "--inspect")
	t.Setenv("OCTOBUS_TEST_CANARY", "leaked")
	tmp := t.TempDir()
	t.Setenv("TMPDIR", tmp)
	seen := filepath.Join(t.TempDir(), "probe")
	fakeNode(t, "v25.0.0", `printf '%s\n%s\n%s\n%s\n%s' "$NODE_OPTIONS" "$HOME" "$(pwd -P)" "${OCTOBUS_TEST_CANARY-unset}" "$([ -d "$TMPDIR" ] && echo tmpdir)" > `+seen)
	node, err := CheckNode(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !node.grantsNet() {
		t.Fatalf("CheckNode on v25 = %+v, want network granted", node)
	}
	raw, err := os.ReadFile(seen)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(string(raw), "\n")
	if len(lines) != 5 {
		t.Fatalf("probe report = %q", raw)
	}
	options, home, cwd, canary, tmpdir := lines[0], lines[1], lines[2], lines[3], lines[4]
	// Apply creates the runtime temp dir, so its presence shows the probe was
	// launched through Apply.
	if tmpdir != "tmpdir" {
		t.Fatal("probe TMPDIR does not exist: the probe bypassed Apply")
	}
	if !strings.HasPrefix(options, "--permission ") || !strings.HasSuffix(options, " --allow-net --max-old-space-size=512") {
		t.Fatalf("probe NODE_OPTIONS = %q, want the runtime flags", options)
	}
	for _, grant := range []string{`--allow-fs-read="`, `--allow-fs-write="`} {
		i := strings.Index(options, grant)
		if i < 0 {
			t.Fatalf("probe NODE_OPTIONS = %q, missing %s", options, grant)
		}
		// The probe dir name has a space, so the grant must stay quoted.
		path, _, ok := strings.Cut(options[i+len(grant):], `"`)
		if !ok || !strings.Contains(path, " ") {
			t.Fatalf("probe NODE_OPTIONS = %q, want a quoted grant for a path with a space", options)
		}
	}
	if strings.Contains(options, "--inspect") {
		t.Fatalf("probe inherited the caller's NODE_OPTIONS: %q", options)
	}
	// The probe dir is gone by now, so compare names rather than resolving
	// symlinks (cwd is reported resolved, HOME as given).
	if base := filepath.Base(cwd); !strings.HasPrefix(base, "octobus node probe ") || filepath.Base(home) != base {
		t.Fatalf("probe HOME = %q, cwd = %q, want both to be the probe dir", home, cwd)
	}
	if canary != "unset" {
		t.Fatalf("probe inherited a daemon variable outside the allowlist: %q", canary)
	}
	if left, err := os.ReadDir(tmp); err != nil || len(left) != 0 {
		t.Fatalf("probe dir not removed: %v %v", left, err)
	}
}
