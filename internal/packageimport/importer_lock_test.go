package packageimport

import (
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestLockServiceSerializesSameService verifies that concurrent commits for
// the same service are mutually exclusive: only one holder may be inside the
// critical section at any time.
func TestLockServiceSerializesSameService(t *testing.T) {
	imp := &Importer{}
	const goroutines = 16
	const rounds = 8

	var (
		start     = make(chan struct{})
		active    int32
		maxActive int32
		wg        sync.WaitGroup
	)
	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			for round := 0; round < rounds; round++ {
				unlock := imp.lockService("shared-service")
				cur := atomic.AddInt32(&active, 1)
				for {
					prev := atomic.LoadInt32(&maxActive)
					if cur <= prev || atomic.CompareAndSwapInt32(&maxActive, prev, cur) {
						break
					}
				}
				runtime.Gosched()
				atomic.AddInt32(&active, -1)
				unlock()
			}
		}()
	}
	close(start)
	wg.Wait()

	if got := atomic.LoadInt32(&maxActive); got != 1 {
		t.Fatalf("max concurrent holders for one service = %d, want 1", got)
	}
}

// TestLockServiceRecyclesIdleEntries verifies the reference-counted entry is
// removed from importLocks once the last holder releases it, so the map cannot
// grow without bound across repeated imports.
func TestLockServiceRecyclesIdleEntries(t *testing.T) {
	imp := &Importer{}
	for round := 0; round < 50; round++ {
		unlock := imp.lockService("ephemeral-service")
		unlock()
		if lock := imp.importLocks["ephemeral-service"]; lock != nil {
			t.Fatalf("round %d: entry still present after release: %+v", round, lock)
		}
		if len(imp.importLocks) != 0 {
			t.Fatalf("round %d: importLocks not empty after release: %d entries", round, len(imp.importLocks))
		}
	}

	// Re-lock after full recycle must create a fresh entry that works again.
	unlock := imp.lockService("ephemeral-service")
	unlock()
	if lock := imp.importLocks["ephemeral-service"]; lock != nil {
		t.Fatal("entry leaked after final release")
	}
}

// TestLockServiceAllowsDifferentServicesInParallel verifies the lock is
// per-service and not global: holding one service must not block another.
func TestLockServiceAllowsDifferentServicesInParallel(t *testing.T) {
	imp := &Importer{}
	heldA := make(chan struct{})
	releaseA := make(chan struct{})
	go func() {
		unlock := imp.lockService("service-a")
		close(heldA)
		<-releaseA
		unlock()
	}()

	<-heldA
	start := time.Now()
	unlockB := imp.lockService("service-b")
	unlockB()
	if elapsed := time.Since(start); elapsed > 100*time.Millisecond {
		t.Fatalf("locking a different service blocked for %v behind service-a", elapsed)
	}
	close(releaseA)
}

// TestLockServiceSurvivesSerializedContentionOnSameService checks the
// reference-counted lock degrades gracefully under heavy contention on one
// service: every waiter eventually acquires and releases without deadlock or
// livelock, and the map entry is recycled once all holders are gone. Note
// mutual exclusion itself (at most one holder inside the critical section) is
// asserted by TestLockServiceSerializesSameService via a concurrency upper
// bound; this test cannot distinguish a pure reference count from a real
// per-service lock, so it deliberately focuses on liveness and cleanup.
func TestLockServiceSurvivesSerializedContentionOnSameService(t *testing.T) {
	imp := &Importer{}
	const waiters = 8
	var entered int64
	var wg sync.WaitGroup
	for w := 0; w < waiters; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			unlock := imp.lockService("contended-service")
			atomic.AddInt64(&entered, 1)
			time.Sleep(2 * time.Millisecond)
			unlock()
		}()
	}
	wg.Wait()
	if got := atomic.LoadInt64(&entered); got != waiters {
		t.Fatalf("entered = %d, want %d", got, waiters)
	}
	if lock := imp.importLocks["contended-service"]; lock != nil {
		t.Fatal("contended-service entry not recycled after all waiters released")
	}
}
