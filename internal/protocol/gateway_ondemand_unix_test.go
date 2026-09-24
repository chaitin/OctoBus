//go:build !windows

package protocol

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"octobus/internal/hardening"
	"octobus/internal/proctest"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/dynamicpb"
)

// testRuntimeNode stands in for the node CheckNode reports. These fixtures are
// shell scripts, so no real node runs.
func testRuntimeNode(t *testing.T) hardening.Node {
	t.Helper()
	node, err := hardening.ParseNodeVersion("v24.0.0")
	if err != nil {
		t.Fatal(err)
	}
	return node
}

func TestGatewayOnDemandInvokeReturnsWhenDescendantHoldsOutput(t *testing.T) {
	for _, level := range []hardening.Level{hardening.LevelOff, hardening.LevelNode} {
		t.Run(fmt.Sprintf("hardening=%s", level), func(t *testing.T) {
			dataDir := t.TempDir()
			st, item, reqRaw, respDesc := seedOnDemandGateway(t, dataDir)
			defer st.Close()
			pidFile := filepath.Join(t.TempDir(), "child.pid")
			// Echo the request, then leave a child that inherits stdout open.
			writeOnDemandEntry(t, dataDir, "echo", item.Service.ServiceRoot, fmt.Sprintf(`#!/bin/sh
cat
sleep 30 &
echo $! > %q
exit 0
`, pidFile))
			gateway := &Gateway{Store: st, DataDir: dataDir, RuntimeHardening: level, RuntimeNode: testRuntimeNode(t)}
			ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-octobus-capset", "dev", "x-octobus-instance", "echo-test"))
			started := time.Now()
			respRaw, err := gateway.invokeRaw(ctx, item, reqRaw)
			if err != nil {
				t.Fatal(err)
			}
			if elapsed := time.Since(started); elapsed > 10*time.Second {
				t.Fatalf("invoke blocked on descendant output for %s", elapsed)
			}
			resp := dynamicpb.NewMessage(respDesc)
			if err := proto.Unmarshal(respRaw, resp); err != nil {
				t.Fatal(err)
			}
			raw, err := os.ReadFile(pidFile)
			if err != nil {
				t.Fatal(err)
			}
			pid, err := strconv.Atoi(strings.TrimSpace(string(raw)))
			if err != nil {
				t.Fatal(err)
			}
			if level != hardening.LevelNode {
				// At level off the descendant outlives the invoke by design.
				_ = syscall.Kill(pid, syscall.SIGKILL)
				return
			}
			// KillGroup already reaped it; signalling the pid again could hit a
			// process that reused it.
			proctest.WaitExited(t, pid)
		})
	}
}

func TestGatewayOnDemandInvokeSurfacesFailureWhenDescendantHoldsOutput(t *testing.T) {
	dataDir := t.TempDir()
	st, item, reqRaw, _ := seedOnDemandGateway(t, dataDir)
	defer st.Close()
	pidFile := filepath.Join(t.TempDir(), "child.pid")
	// The runtime fails while a descendant keeps stdout open: the WaitDelay
	// error must not mask the non-zero exit and its stderr.
	writeOnDemandEntry(t, dataDir, "echo", item.Service.ServiceRoot, fmt.Sprintf(`#!/bin/sh
echo 'OCTOBUS_ERROR:{"code":"INVALID_ARGUMENT","message":"bad request"}' >&2
sleep 30 &
echo $! > %q
exit 3
`, pidFile))
	gateway := &Gateway{Store: st, DataDir: dataDir, RuntimeHardening: hardening.LevelNode, RuntimeNode: testRuntimeNode(t)}
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-octobus-capset", "dev", "x-octobus-instance", "echo-test"))
	respRaw, err := gateway.invokeRaw(ctx, item, reqRaw)
	// At level node KillGroup must have cleaned up the descendant as well.
	if raw, readErr := os.ReadFile(pidFile); readErr == nil {
		if pid, convErr := strconv.Atoi(strings.TrimSpace(string(raw))); convErr == nil {
			proctest.WaitExited(t, pid)
		}
	}
	if err == nil {
		t.Fatalf("expected runtime failure, got response %x", respRaw)
	}
	if status.Code(err) != codes.InvalidArgument || !strings.Contains(status.Convert(err).Message(), "bad request") {
		t.Fatalf("runtime error not surfaced: %v", err)
	}
}
