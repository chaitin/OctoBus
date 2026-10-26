package supervisor

import (
	"context"
	"sync"

	"octobus/internal/domain"
)

// instanceGate serializes lifecycle operations per instance. Public operations
// (CreateInstance, Start, Stop, Restart, SetRuntimeMode, EnsureStarted,
// UpdateConfig, UpdateSecret) hold the gate for their whole body; internal
// helpers (startLocked, restartLocked) require the caller to hold it. Lock
// order is gate -> s.mu; nothing under s.mu takes a gate.
//
// This is what makes a repeated CreateInstance from a package sync idempotent
// against concurrent manual operations, and what makes EnsureStarted a
// singleflight: concurrent first calls queue on one start instead of stacking
// processes.
type instanceGate struct {
	mu sync.Mutex
}

func (s *Supervisor) lockInstance(instanceID string) func() {
	s.gatesMu.Lock()
	if s.gates == nil {
		s.gates = map[string]*instanceGate{}
	}
	gate := s.gates[instanceID]
	if gate == nil {
		gate = &instanceGate{}
		s.gates[instanceID] = gate
	}
	s.gatesMu.Unlock()
	gate.mu.Lock()
	// The gate entry is intentionally left in the map: it is a few dozen bytes
	// per instance ever seen, and removing it here would race a second caller
	// that just resolved the same gate and is about to lock it.
	return gate.mu.Unlock
}

// startLocked starts the instance's resident process. The gate must be held.
func (s *Supervisor) startLocked(ctx context.Context, instanceID string) error {
	s.mu.Lock()
	generation := s.nextGenerationLocked(instanceID)
	s.mu.Unlock()
	return s.startWithAttempt(ctx, instanceID, 0, generation)
}

// restartLocked stops then starts the instance when it was enabled. The gate
// must be held.
func (s *Supervisor) restartLocked(ctx context.Context, instanceID string, wasEnabled bool) error {
	inst, err := s.Store.GetInstance(ctx, instanceID)
	if err != nil {
		return err
	}
	svc, err := s.Store.GetService(ctx, inst.ServiceID)
	if err != nil {
		return err
	}
	mode := domain.EffectiveRuntimeMode(svc, inst)
	if mode == domain.RuntimeModeOnDemand {
		return ErrUnsupportedRuntimeControl
	}
	s.mu.Lock()
	tracked := s.liveProcessLocked(instanceID)
	s.mu.Unlock()
	if !tracked && mode == domain.RuntimeModeScaleToZero {
		// A cold scale-to-zero instance has nothing to restart: the caller has
		// already written the new content, and restarting would warm it for a
		// full idle TTL. The next call warms it with the new content. A row
		// still claiming a running/stale process is a crash remnant: land it
		// cold instead of reporting success over a lying row.
		if inst.PID != nil || inst.ListenAddr != "" ||
			inst.Status == domain.StatusRunning || inst.Status == domain.StatusStarting {
			inst.PID = nil
			inst.ListenAddr = ""
			inst.Status = domain.StatusStopped
			if err := s.Store.UpsertInstance(ctx, inst); err != nil {
				return err
			}
			s.notifyInstanceChanged(instanceID)
		}
		return nil
	}
	s.logger().Info("instance_restart_requested", "instance_id", instanceID)
	if err := s.stopProcess(ctx, inst, wasEnabled); err != nil {
		return err
	}
	if !wasEnabled {
		inst.Enabled = false
		inst.Status = domain.StatusStopped
		inst.PID = nil
		inst.ListenAddr = ""
		if err := s.Store.UpsertInstance(ctx, inst); err != nil {
			return err
		}
		s.notifyInstanceChanged(instanceID)
		return nil
	}
	return s.startLocked(ctx, instanceID)
}

// withGate runs fn while holding the instance gate.
func (s *Supervisor) withGate(instanceID string, fn func() error) error {
	unlock := s.lockInstance(instanceID)
	defer unlock()
	return fn()
}
