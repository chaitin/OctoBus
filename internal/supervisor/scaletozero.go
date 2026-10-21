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
		s.refCounts[instanceID]++
		s.mu.Unlock()
		return func() { s.releaseRef(instanceID) }, nil
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
	s.refCounts[instanceID]++
	s.mu.Unlock()
	return func() { s.releaseRef(instanceID) }, nil
}

func (s *Supervisor) releaseRef(instanceID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.refCounts[instanceID] <= 1 {
		delete(s.refCounts, instanceID)
		return
	}
	s.refCounts[instanceID]--
}

// ReleaseInstance drops the request ref taken by EnsureStarted.
func (s *Supervisor) ReleaseInstance(instanceID string) {
	s.releaseRef(instanceID)
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
		if s.refCounts[id] > 0 {
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
	if len(s.procs) > 0 {
		s.logger().Info("scale_to_zero_scan_done",
			"warm", len(s.procs),
			"cold_starts", s.counters.ScaleToZeroColdStarts,
			"hot_hits", s.counters.ScaleToZeroHotHits,
			"idle_stops", s.counters.ScaleToZeroIdleStops,
			"lru_evictions", s.counters.ScaleToZeroLRUEvicted)
	}
	s.mu.Unlock()

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
				if parked[id] || s.refCounts[id] > 0 {
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
	refHeld := s.refCounts[instanceID] > 0
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
	if inst.PID == nil && s.procs[instanceID] == nil {
		return false
	}
	if err := s.stopProcess(ctx, inst, true); err != nil {
		s.logger().Warn("scale_to_zero_park_failed", "instance_id", instanceID, "error", err)
		return false
	}
	s.logger().Info("scale_to_zero_parked", "instance_id", instanceID)
	return true
}

// StartScaleToZeroLoop launches the idle-stop and LRU scan. It returns immediately;
// the loop exits when the supervisor's lifecycle context is cancelled.
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
			case <-ticker.C:
				s.scanScaleToZero(ctx)
			}
		}
	}()
}

// StartReconcileLoop launches the process reconciliation backstop. It returns
// immediately; the loop exits when the supervisor's lifecycle context is
// cancelled. The first pass runs immediately: a daemon that restarted after a
// kill -9 gets its stale rows repaired on the way up, not five minutes later.
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
	services := map[string]domain.Service{}
	s.mu.Lock()
	defer s.mu.Unlock()
	for id := range s.procs {
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
		s.scaleToZeroModes[id] = domain.EffectiveRuntimeMode(svc, inst) == domain.RuntimeModeScaleToZero
	}
}
