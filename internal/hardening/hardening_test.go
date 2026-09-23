package hardening

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestEnvDropsUnlistedVariables(t *testing.T) {
	t.Setenv("OCTOBUS_TEST_SECRET_TOKEN", "leak")
	t.Setenv("NODE_OPTIONS", "--inspect")
	t.Setenv("TZ", "UTC")
	workdir := t.TempDir()
	env := Env(Spec{Level: LevelNode, ServiceDir: t.TempDir(), Workdir: workdir, Env: []string{"OCTOBUS_SERVICE_ID=svc"}})
	joined := "\n" + strings.Join(env, "\n") + "\n"
	tmpDir := filepath.Join(workdir, "tmp")
	for _, want := range []string{"\nTZ=UTC\n", "\nHOME=" + workdir + "\n", "\nTMPDIR=" + tmpDir + "\n", "\nTEMP=" + tmpDir + "\n", "\nTMP=" + tmpDir + "\n", "\nOCTOBUS_SERVICE_ID=svc\n"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("env missing %q: %v", strings.TrimSpace(want), env)
		}
	}
	if strings.Contains(joined, "OCTOBUS_TEST_SECRET_TOKEN") || strings.Contains(joined, "--inspect") {
		t.Fatalf("env leaked daemon variables: %v", env)
	}
}

func TestNodeOptionsQuotesPathsAndSetsLimits(t *testing.T) {
	// Build absolute paths for the host OS: pathVariants passes each dir
	// through filepath.Abs, which adds a drive letter to "/data" on Windows.
	root := t.TempDir()
	serviceDir := filepath.Join(root, "my svc")
	workdir := filepath.Join(root, "work dir")
	opts := NodeOptions(Spec{Level: LevelNode, ServiceDir: serviceDir, Workdir: workdir})
	for _, want := range []string{
		"--permission",
		"--allow-fs-read=" + quoteNodeOption(serviceDir),
		"--allow-fs-read=" + quoteNodeOption(workdir),
		"--allow-fs-write=" + quoteNodeOption(workdir),
		"--max-old-space-size=512",
	} {
		if !strings.Contains(opts, want) {
			t.Fatalf("NODE_OPTIONS missing %q: %s", want, opts)
		}
	}
	// The service dir may appear only in its single read grant.
	if strings.Count(opts, "my svc") != 1 {
		t.Fatalf("service dir must stay read-only: %s", opts)
	}
	if strings.Contains(opts, "--allow-net") {
		t.Fatalf("node before 25 rejects --allow-net: %s", opts)
	}
	if opts := NodeOptions(Spec{Level: LevelNode, ServiceDir: serviceDir, Workdir: workdir, Node: testNode(t, "v25.0.0")}); !strings.Contains(opts, "--allow-net") {
		t.Fatalf("node 25+ needs --allow-net to keep network access: %s", opts)
	}
	if got := quoteNodeOption(`/data/my "svc"`); got != `"/data/my \"svc\""` {
		t.Fatalf("quotes not escaped: %s", got)
	}
	if got := quoteNodeOption(`C:\svc`); got != `"C:\\svc"` {
		t.Fatalf("backslashes not escaped: %s", got)
	}
}

func TestApplyRejectsUnknownLevel(t *testing.T) {
	cmd := exec.Command("node")
	err := Apply(cmd, Spec{Level: "kernel", Node: testNode(t, "v24.0.0"), ServiceDir: t.TempDir(), Workdir: t.TempDir()})
	if err == nil || !strings.Contains(err.Error(), `unsupported level "kernel"`) {
		t.Fatalf("Apply with an unknown level = %v, want an error", err)
	}
	if cmd.Env != nil || cmd.SysProcAttr != nil {
		t.Fatalf("rejected Apply must not configure the command: env=%v attr=%+v", cmd.Env, cmd.SysProcAttr)
	}
}

func TestPathVariantsIncludesResolvedSymlink(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation needs privileges on windows")
	}
	root := t.TempDir()
	real := filepath.Join(root, "real")
	link := filepath.Join(root, "link")
	if err := os.Mkdir(real, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(real, link); err != nil {
		t.Fatal(err)
	}
	resolvedReal, err := filepath.EvalSymlinks(real)
	if err != nil {
		t.Fatal(err)
	}
	got := pathVariants(link, link, "")
	if len(got) != 2 || got[0] != link || got[1] != resolvedReal {
		t.Fatalf("pathVariants = %v, want [%s %s]", got, link, resolvedReal)
	}
}

func TestApplyValidatesAndCreatesTempDir(t *testing.T) {
	if err := Apply(exec.Command("true"), Spec{}); err == nil {
		t.Fatal("expected error for empty spec")
	}
	workdir := t.TempDir()
	cmd := exec.Command("true")
	if err := Apply(cmd, Spec{Level: LevelNode, Node: testNode(t, "v24.0.0"), ServiceDir: t.TempDir(), Workdir: workdir}); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Stat(filepath.Join(workdir, "tmp")); err != nil || !info.IsDir() {
		t.Fatalf("temp dir not created: %v", err)
	}
	if len(cmd.Env) == 0 {
		t.Fatal("cmd env not set")
	}
}

func TestApplyAtLevelOffInheritsDaemonEnv(t *testing.T) {
	t.Setenv("OCTOBUS_TEST_INHERITED", "yes")
	workdir := t.TempDir()
	cmd := exec.Command("true")
	cmd.Dir = workdir
	if err := Apply(cmd, Spec{ServiceDir: t.TempDir(), Workdir: workdir, Env: []string{"OCTOBUS_SERVICE_ID=svc"}}); err != nil {
		t.Fatal(err)
	}
	joined := "\n" + strings.Join(cmd.Env, "\n") + "\n"
	if !strings.Contains(joined, "\nOCTOBUS_TEST_INHERITED=yes\n") || !strings.Contains(joined, "\nOCTOBUS_SERVICE_ID=svc\n") {
		t.Fatalf("env not inherited: %v", cmd.Env)
	}
	if strings.Contains(joined, "--permission") {
		t.Fatalf("permission model enabled at level off: %v", cmd.Env)
	}
	if _, err := os.Stat(filepath.Join(workdir, "tmp")); !os.IsNotExist(err) {
		t.Fatalf("temp dir created at level off: %v", err)
	}
	if cmd.Dir != workdir {
		t.Fatalf("dir rewritten at level off: %s", cmd.Dir)
	}
}

func TestApplyResolvesSymlinkedEntryAndDir(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation needs privileges on windows")
	}
	root := t.TempDir()
	real := filepath.Join(root, "real")
	if err := os.Mkdir(real, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(real, "entry"), []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "link")
	if err := os.Symlink(real, link); err != nil {
		t.Fatal(err)
	}
	resolved, err := filepath.EvalSymlinks(real)
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(filepath.Join(link, "entry"))
	cmd.Dir = link
	if err := Apply(cmd, Spec{Level: LevelNode, Node: testNode(t, "v24.0.0"), ServiceDir: link, Workdir: link}); err != nil {
		t.Fatal(err)
	}
	if cmd.Path != filepath.Join(resolved, "entry") || cmd.Dir != resolved {
		t.Fatalf("path=%s dir=%s, want resolved under %s", cmd.Path, cmd.Dir, resolved)
	}
}

func TestApplyAtLevelOffKeepsDaemonProcessGroup(t *testing.T) {
	cmd := exec.Command("true")
	if err := Apply(cmd, Spec{ServiceDir: t.TempDir(), Workdir: t.TempDir()}); err != nil {
		t.Fatal(err)
	}
	if cmd.SysProcAttr != nil {
		t.Fatalf("process group set at level off: %+v", cmd.SysProcAttr)
	}
}

func TestSignalNilCommand(t *testing.T) {
	if err := Signal(nil, os.Interrupt); err != os.ErrProcessDone {
		t.Fatalf("Signal(nil) = %v", err)
	}
	if err := Kill(&exec.Cmd{}); err != os.ErrProcessDone {
		t.Fatalf("Kill(unstarted) = %v", err)
	}
	KillGroup(nil)
}

func TestCheckNodeVersion(t *testing.T) {
	for _, tc := range []struct {
		version  string
		ok       bool
		grantNet bool
	}{
		{"v24.11.1", true, false},
		{"v25.0.0", true, true},
		{"v26.1.0", true, true},
		{"v23.5.0", true, false},
		{"v23.4.0", false, false},
		{"v22.13.0", true, false},
		{"v22.12.9", false, false},
		{"v20.18.1", false, false},
		{"garbage", false, false},
		{"vX.1.2", false, false},
	} {
		node, err := ParseNodeVersion(tc.version)
		if (err == nil) != tc.ok {
			t.Fatalf("ParseNodeVersion(%q) = %v, want ok=%v", tc.version, err, tc.ok)
		}
		if node.grantsNet() != tc.grantNet {
			t.Fatalf("ParseNodeVersion(%q).grantsNet() = %v, want %v", tc.version, node.grantsNet(), tc.grantNet)
		}
	}
}

// testNode returns the Node CheckNode would report for version.
func testNode(t *testing.T, version string) Node {
	t.Helper()
	node, err := ParseNodeVersion(version)
	if err != nil {
		t.Fatal(err)
	}
	return node
}

func TestApplyRequiresCheckedNodeAtLevelNode(t *testing.T) {
	cmd := exec.Command("node")
	err := Apply(cmd, Spec{Level: LevelNode, ServiceDir: t.TempDir(), Workdir: t.TempDir()})
	if err == nil || !strings.Contains(err.Error(), "requires a node checked at daemon startup") {
		t.Fatalf("Apply with an unchecked node = %v, want an unchecked-node error", err)
	}
	if cmd.Env != nil {
		t.Fatalf("rejected Apply must not configure the command: %v", cmd.Env)
	}
}

func TestCheckNodeUsesNodeOnPath(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not installed")
	}
	out, err := exec.Command("node", "--version").Output()
	if err != nil {
		t.Fatal(err)
	}
	wantNode, want := ParseNodeVersion(strings.TrimSpace(string(out)))
	gotNode, got := CheckNode(context.Background())
	if (got == nil) != (want == nil) || gotNode != wantNode {
		t.Fatalf("CheckNode = %+v, %v; ParseNodeVersion = %+v, %v", gotNode, got, wantNode, want)
	}
	t.Setenv("PATH", t.TempDir())
	if _, err := CheckNode(context.Background()); err == nil {
		t.Fatal("expected error when node is missing from PATH")
	}
}

func TestParseLevel(t *testing.T) {
	for _, tc := range []struct {
		value   string
		want    Level
		wantErr bool
	}{
		{"", LevelOff, false},
		{"off", LevelOff, false},
		{"node", LevelNode, false},
		{"Node", "", true},
		{"kernel", "", true},
		{"true", "", true},
	} {
		got, err := ParseLevel(tc.value)
		if got != tc.want || (err != nil) != tc.wantErr {
			t.Fatalf("ParseLevel(%q) = %q, %v; want %q, err=%v", tc.value, got, err, tc.want, tc.wantErr)
		}
	}
}
