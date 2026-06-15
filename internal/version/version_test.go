package version

import "testing"

func TestInfoString(t *testing.T) {
	got := Info{Version: "v1.2.3", Commit: "abc1234", Date: "2026-06-15T01:02:03Z"}.String()
	want := "version: v1.2.3\ncommit: abc1234\ndate: 2026-06-15T01:02:03Z\n"
	if got != want {
		t.Fatalf("Info.String() = %q, want %q", got, want)
	}
}

func TestCurrentUsesBuildVariables(t *testing.T) {
	origVersion, origCommit, origDate := Version, Commit, Date
	t.Cleanup(func() {
		Version, Commit, Date = origVersion, origCommit, origDate
	})

	Version = "v9.9.9"
	Commit = "deadbeef"
	Date = "2026-06-15T00:00:00Z"

	got := Current()
	if got.Version != Version || got.Commit != Commit || got.Date != Date {
		t.Fatalf("Current() = %+v, want build variables", got)
	}
}
