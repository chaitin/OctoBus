package supervisor

import (
	"context"
	"time"

	"octobus/internal/domain"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Scale-to-zero mode defaults; main.go fills the Supervisor fields from the
// OCTOBUS_SCALE_TO_ZERO_* environment, tests set the fields directly.
const (
	DefaultScaleToZeroIdleTTL      = 15 * time.Minute
	DefaultScaleToZeroMaxInstances = 32
	// DefaultReconcileInterval is the reconcile loop's production period.
	DefaultReconcileInterval = 5 * time.Minute
)

// scanInterval derives the scale-to-zero scan period from the TTL: frequent enough that
// idle stops land well inside the TTL, coarse enough not to wake the daemon.
func scanInterval(ttl time.Duration) time.Duration {
	if ttl <= 0 {
		return time.Minute
	}
	interval := ttl / 4
	if interval < time.Second {
		return time.Second
	}
	if interval > time.Minute {
		return time.Minute
	}
	return interval
}

// EnsureStarted warms a scale-to-zero instance for an incoming request. It is
// the mode's hot path: a tracked instance returns after a lastActivity refresh; a
// cold one starts under the instance gate, which merges concurrent callers
// into one start.
//
// The start itself runs on a context detached from the winning request: a
// caller that gives up mid-start must not kill the process everyone else is
// queued for, nor fail the queued callers with its cancellation. Detachment is
// bounded -- the start's own 5s health timeout is the ceiling -- so a start
// nobody waits for cannot outlive the request timeout it replaced. A queued
// caller cannot abandon the mutex wait itself, but its cancellation is observed
// as soon as it acquires the gate: it returns before taking a ref or touching
// the process.
//
// The returned release drops the request ref taken here. A held ref keeps the
// idle stopper and the LRU from parking the instance mid-request, streams
// included.
func (s *Supervisor) EnsureStarted(ctx context.Context, instanceID string) (release func(), err error) {
	if ctx == nil {
		ctx = context.Background()
	}
	unlock := s.lockInstance(instanceID)
	defer unlock()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.Lock()
	if s.liveProcessLocked(instanceID) {
		s.lastActivity[instanceID] = time.Now()
		state := s.procs[instanceID]
		state.refs++
		s.counters.ScaleToZeroHotHits++
		s.mu.Unlock()
		return func() { s.releaseRef(state) }, nil
	}
	s.mu.Unlock()
	inst, err := s.Store.GetInstance(ctx, instanceID)
	if err != nil {
		return nil, err
	}
	if !inst.Enabled {
		// A stopped instance is not a cold start: do not count it or touch its
		// activity clock.
		return nil, status.Error(codes.Unavailable, "backend instance is stopped")
	}
	// Detach the start from this request: the health-check window and the
	// process teardown run on their own clock, not the caller's.
	startCtx, cancel := context.WithCancel(context.WithoutCancel(ctx))
	defer cancel()
	s.mu.Lock()
	if failure, ok := s.startFailures[instanceID]; ok {
		if time.Since(failure.at) < startFailureWindow {
			err := failure.err
			s.mu.Unlock()
			// Queued callers share the winner's failure instead of each
			// running another full health-checked start.
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			return nil, err
		}
		delete(s.startFailures, instanceID)
	}
	s.lastActivity[instanceID] = time.Now()
	s.counters.ScaleToZeroColdStarts++
	s.mu.Unlock()
	if err := s.startLocked(startCtx, instanceID); err != nil {
		s.mu.Lock()
		s.startFailures[instanceID] = startFailure{err: err, at: time.Now()}
		s.mu.Unlock()
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		// The process is warm now; a caller that gave up while the detached
		// start ran must not take a ref or issue a doomed backend call.
		return nil, err
	}
	s.mu.Lock()
	delete(s.startFailures, instanceID)
	state := s.procs[instanceID]
	if state != nil {
		state.refs++
	}
	s.mu.Unlock()
	return func() { s.releaseRef(state) }, nil
}

// releaseRef drops one in-flight request ref. The release closure holds the
// state pointer it captured, so a straggler release from an exited process
// decrements the old state and cannot affect its successor.
func (s *Supervisor) releaseRef(state *processState) {
	if state == nil {
		return
	}
	s.mu.Lock()
	state.refs--
	s.mu.Unlock()
}

// TracksInstance reports whether the supervisor currently tracks a process for
// the instance, i.e. whether a resident instance is warm.
func (s *Supervisor) TracksInstance(instanceID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.liveProcessLocked(instanceID)
}

// TouchInstance refreshes a scale-to-zero instance's activity clock without taking its
// gate. The gateway calls it per streamed message, where routing a frame
// through the instance gate would serialize concurrent frames for no benefit.
func (s *Supervisor) TouchInstance(instanceID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.procs[instanceID] != nil {
		s.lastActivity[instanceID] = time.Now()
	}
}

// scanScaleToZero runs one idle-stop and LRU pass over warm scale-to-zero instances. Only
// tracked instances count: the reconcile pass owns untracked processes.
func (s *Supervisor) scanScaleToZero(ctx context.Context) {
	s.mu.Lock()
	ttl := s.stzIdleTTL
	warmCap := s.stzMaxWarm
	anyScaleToZero := false
	for _, st := range s.procs {
		if st.scaleToZero {
			anyScaleToZero = true
			break
		}
	}
	s.mu.Unlock()
	if ttl <= 0 && warmCap <= 0 {
		return
	}
	if !anyScaleToZero {
		// No tracked process is in scale-to-zero mode, so there is nothing to
		// park. The mode is recorded on the process state at start and on every
		// mode change, so this cannot miss a switch into the mode.
		return
	}
	now := time.Now()
	var idleExpired []string
	s.mu.Lock()
	for id, st := range s.procs {
		if !st.scaleToZero {
			continue
		}
		if st.refs > 0 {
			continue
		}
		if ttl > 0 && now.Sub(s.lastActivity[id]) > ttl {
			idleExpired = append(idleExpired, id)
		}
	}
	s.mu.Unlock()

	parked := map[string]bool{}
	for _, id := range idleExpired {
		if s.parkIfStillIdle(ctx, id, now) {
			parked[id] = true
			s.mu.Lock()
			s.counters.ScaleToZeroIdleStops++
			s.mu.Unlock()
			s.logger().Info("scale_to_zero_idle_stopped", "instance_id", id)
		}
	}

	// One summary line per pass is the metrics surface until the daemon grows
	// a Prometheus endpoint: cold/hit ratio answers the production question
	// ("how many calls skipped the cold start"), stops and evictions answer
	// whether the TTL and cap are tuned right. An empty pool has nothing to
	// report; deployments without scale-to-zero instances would otherwise log a
	// constant zero row around the clock.
	s.mu.Lock()
	warm := 0
	for _, st := range s.procs {
		if st.scaleToZero {
			warm++
		}
	}
	coldStarts := s.counters.ScaleToZeroColdStarts
	hotHits := s.counters.ScaleToZeroHotHits
	idleStops := s.counters.ScaleToZeroIdleStops
	lruEvictions := s.counters.ScaleToZeroLRUEvicted
	s.mu.Unlock()
	// An empty pool has nothing to report: a long-running-only deployment must
	// not get a constant zero row around the clock.
	if warm > 0 {
		s.logger().Info("scale_to_zero_scan_done",
			"warm", warm,
			"cold_starts", coldStarts,
			"hot_hits", hotHits,
			"idle_stops", idleStops,
			"lru_evictions", lruEvictions)
	}

	if warmCap > 0 {
		for {
			s.mu.Lock()
			// Only warm scale-to-zero instances count against the cap: long-running
			// residents are not the pool's business.
			over := 0
			victim := ""
			var oldest time.Time
			for id, st := range s.procs {
				if !st.scaleToZero {
					continue
				}
				over++
				if parked[id] || st.refs > 0 {
					continue
				}
				activity := s.lastActivity[id]
				if victim == "" || activity.Before(oldest) {
					victim = id
					oldest = activity
				}
			}
			over -= warmCap
			s.mu.Unlock()
			if victim == "" || over <= 0 {
				break
			}
			if !s.parkIfStillIdle(ctx, victim, now) {
				// Ref'd or gone cold on its own; leave it for the next pass.
				parked[victim] = true
				continue
			}
			parked[victim] = true
			s.mu.Lock()
			s.counters.ScaleToZeroLRUEvicted++
			s.mu.Unlock()
			s.logger().Info("scale_to_zero_lru_evicted", "instance_id", victim)
		}
	}
}

// parkIfStillIdle re-checks idle state under the instance gate, then stops. The
// gate closes the race where a request arrives between the scan and the stop:
// a caller that won the gate first either started the instance (we see it
// tracked with a fresh lastActivity or a ref and skip) or lost and is about to
// start after we park (its start then runs after our stop and warms it again).
func (s *Supervisor) parkIfStillIdle(ctx context.Context, instanceID string, scannedAt time.Time) bool {
	unlock := s.lockInstance(instanceID)
	defer unlock()
	s.mu.Lock()
	tracked := s.procs[instanceID] != nil
	fresh := s.lastActivity[instanceID].After(scannedAt)
	refHeld := false
	if st := s.procs[instanceID]; st != nil {
		refHeld = st.refs > 0
	}
	s.mu.Unlock()
	if !tracked || fresh || refHeld {
		return false
	}
	return s.parkLocked(ctx, instanceID)
}

// parkLocked stops a warm scale-to-zero instance, leaving the row enabled and stopped:
// cold, not disabled. The gate must be held. It reports whether the instance
// was actually parked; a row with no pid is already cold (the exit watcher
// beat us) and reports false.
func (s *Supervisor) parkLocked(ctx context.Context, instanceID string) bool {
	inst, err := s.Store.GetInstance(ctx, instanceID)
	if err != nil {
		s.logger().Warn("scale_to_zero_park_lookup_failed", "instance_id", instanceID, "error", err)
		return false
	}
	svc, err := s.Store.GetService(ctx, inst.ServiceID)
	if err != nil {
		s.logger().Warn("scale_to_zero_park_lookup_failed", "instance_id", instanceID, "error", err)
		return false
	}
	// Re-check the effective mode under the gate, which every mode change
	// holds: a switch to long-running that landed after the scan collected
	// this id must not be parked -- a parked long-running row is
	// enabled/stopped, and nothing restarts it from there.
	if domain.EffectiveRuntimeMode(svc, inst) != domain.RuntimeModeScaleToZero {
		return false
	}
	// parkIfStillIdle released s.mu before calling us, and other instances'
	// starts and stops write this map concurrently; read it under the lock.
	s.mu.Lock()
	tracked := s.procs[instanceID] != nil
	s.mu.Unlock()
	if inst.PID == nil && !tracked {
		return false
	}
	if err := s.stopProcess(ctx, inst, true); err != nil {
		s.logger().Warn("scale_to_zero_park_failed", "instance_id", instanceID, "error", err)
		return false
	}
	// The callers log the classified event: idle TTL versus LRU eviction.
	return true
}

// StartScaleToZeroLoop launches the idle-stop and LRU scan. It returns
// immediately; the loop exits when the passed context or the supervisor's
// lifecycle context is cancelled -- Shutdown cancels the latter, so the loop
// cannot outlive the supervisor even when the caller's context keeps running.
func (s *Supervisor) StartScaleToZeroLoop(ctx context.Context, ttl time.Duration, maxWarm int) {
	s.mu.Lock()
	s.stzIdleTTL = ttl
	s.stzMaxWarm = maxWarm
	s.mu.Unlock()
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		ticker := time.NewTicker(scanInterval(ttl))
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-s.lifecycleContext().Done():
				return
			case <-ticker.C:
				s.scanScaleToZero(ctx)
			}
		}
	}()
}

// StartReconcileLoop launches the process reconciliation backstop. It returns
// immediately; the loop exits when the passed context or the supervisor's
// lifecycle context is cancelled. The first pass runs immediately: a daemon
// that restarted after a kill -9 gets its stale rows repaired on the way up,
// not five minutes later.
func (s *Supervisor) StartReconcileLoop(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = DefaultReconcileInterval
	}
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		reconcileCtx, cancel := context.WithCancel(s.lifecycleContext())
		defer cancel()
		s.ReconcileProcesses(reconcileCtx)
		for {
			select {
			case <-ctx.Done():
				return
			case <-s.lifecycleContext().Done():
				return
			case <-ticker.C:
				s.ReconcileProcesses(reconcileCtx)
			}
		}
	}()
}
