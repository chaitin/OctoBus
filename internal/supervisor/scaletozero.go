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
// nobody waits for cannot outlive the request timeout it replaced. Waiters
// that hang up while queued simply stop waiting: the gate releases them and
// their request ctx propagates the cancellation.
//
// The returned release drops the request ref taken here. A held ref keeps the
// idle stopper and the LRU from parking the instance mid-request, streams
// included.
func (s *Supervisor) EnsureStarted(ctx context.Context, instanceID string) (release func(), err error) {
	unlock := s.lockInstance(instanceID)
	defer unlock()
	s.mu.Lock()
	s.lastActivity[instanceID] = time.Now()
	if state := s.procs[instanceID]; state != nil {
		s.counters.ScaleToZeroHotHits++
		generation := state.generation
		s.addRefLocked(instanceID, generation)
		s.mu.Unlock()
		return func() { s.releaseRef(instanceID, generation) }, nil
	}
	s.counters.ScaleToZeroColdStarts++
	s.mu.Unlock()
	inst, err := s.Store.GetInstance(ctx, instanceID)
	if err != nil {
		return nil, err
	}
	if !inst.Enabled {
		return nil, status.Error(codes.Unavailable, "backend instance is stopped")
	}
	// Detach the start from this request: the health-check window and the
	// process teardown run on their own clock, not the caller's.
	startCtx, cancel := context.WithCancel(context.WithoutCancel(ctx))
	defer cancel()
	if err := s.startLocked(startCtx, instanceID); err != nil {
		return nil, err
	}
	s.mu.Lock()
	generation := s.generations[instanceID]
	if state := s.procs[instanceID]; state != nil {
		generation = state.generation
	}
	s.addRefLocked(instanceID, generation)
	s.mu.Unlock()
	return func() { s.releaseRef(instanceID, generation) }, nil
}

// addRefLocked records one in-flight request against the process generation
// serving it. The caller must hold s.mu.
func (s *Supervisor) addRefLocked(instanceID string, generation int64) {
	ref := s.refCounts[instanceID]
	if ref.generation != generation {
		ref = instanceRefs{generation: generation}
	}
	ref.count++
	s.refCounts[instanceID] = ref
}

// releaseRef drops one in-flight request ref. A release that belongs to a
// previous generation is a no-op: its process is gone and wait() already
// dropped that generation's count, so the current entry belongs to a
// successor.
func (s *Supervisor) releaseRef(instanceID string, generation int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ref := s.refCounts[instanceID]
	if ref.generation != generation || ref.count == 0 {
		return
	}
	if ref.count == 1 {
		delete(s.refCounts, instanceID)
		return
	}
	ref.count--
	s.refCounts[instanceID] = ref
}

// TracksInstance reports whether the supervisor currently tracks a process for
// the instance, i.e. whether a resident instance is warm.
func (s *Supervisor) TracksInstance(instanceID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.procs[instanceID] != nil
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
	s.refreshScaleToZeroModes(ctx)
	ttl := s.stzIdleTTL
	warmCap := s.stzMaxWarm
	if ttl <= 0 && warmCap <= 0 {
		return
	}
	now := time.Now()
	var idleExpired []string
	s.mu.Lock()
	for id := range s.procs {
		if !s.isScaleToZeroInstance(id) {
			continue
		}
		if s.refCounts[id].count > 0 {
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
	for id := range s.procs {
		if s.scaleToZeroModes[id] {
			warm++
		}
	}
	logSummary := len(s.procs) > 0
	coldStarts := s.counters.ScaleToZeroColdStarts
	hotHits := s.counters.ScaleToZeroHotHits
	idleStops := s.counters.ScaleToZeroIdleStops
	lruEvictions := s.counters.ScaleToZeroLRUEvicted
	s.mu.Unlock()
	if logSummary {
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
			for id := range s.procs {
				if !s.isScaleToZeroInstance(id) {
					continue
				}
				over++
				if parked[id] || s.refCounts[id].count > 0 {
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
	refHeld := s.refCounts[instanceID].count > 0
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
	s.logger().Info("scale_to_zero_parked", "instance_id", instanceID)
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

// isScaleToZeroInstance reports whether the tracked instance's effective mode
// is scale-to-zero.
// The caller holds s.mu, and takes no other lock: the lookup is served from the
// mode cache the supervisor maintains.
func (s *Supervisor) isScaleToZeroInstance(id string) bool {
	return s.scaleToZeroModes[id]
}

// refreshScaleToZeroModes recomputes the scale-to-zero mode cache for every tracked instance.
// Called at the top of each scale-to-zero scan: the loop is the one place that already
// walks tracked instances on a period, and mode changes are admin-rate, not
// request-rate.
func (s *Supervisor) refreshScaleToZeroModes(ctx context.Context) {
	instances, err := s.Store.ListInstances(ctx)
	if err != nil {
		s.logger().Warn("scale_to_zero_mode_refresh_failed", "error", err)
		return
	}
	byID := make(map[string]domain.Instance, len(instances))
	for _, inst := range instances {
		byID[inst.ID] = inst
	}
	// Resolve services outside s.mu: the hot path takes that lock for every
	// request, and a SQLite read here would stall every scale-to-zero call for
	// the duration of the scan.
	s.mu.Lock()
	trackedIDs := make([]string, 0, len(s.procs))
	for id := range s.procs {
		trackedIDs = append(trackedIDs, id)
	}
	s.mu.Unlock()

	modes := make(map[string]bool, len(trackedIDs))
	services := map[string]domain.Service{}
	for _, id := range trackedIDs {
		inst, ok := byID[id]
		if !ok {
			continue
		}
		svc, ok := services[inst.ServiceID]
		if !ok {
			svc, err = s.Store.GetService(ctx, inst.ServiceID)
			if err != nil {
				continue
			}
			services[inst.ServiceID] = svc
		}
		modes[id] = domain.EffectiveRuntimeMode(svc, inst) == domain.RuntimeModeScaleToZero
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	for id, scaleToZero := range modes {
		s.scaleToZeroModes[id] = scaleToZero
	}
}
