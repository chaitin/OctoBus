package supervisor

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"octobus/internal/daemonlog"
	"octobus/internal/domain"
	"octobus/internal/hardening"
	"octobus/internal/packageimport"
	"octobus/internal/store"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	grpc_health_v1 "google.golang.org/grpc/health/grpc_health_v1"
)

var ErrUnsupportedRuntimeControl = errors.New("on-demand runtime mode does not support persistent runtime control")

var errProcessStopTimeout = errors.New("process stop timed out")

type Supervisor struct {
	DataDir           string
	Store             *store.Store
	Logger            *slog.Logger
	OnInstanceChanged func(instanceID string)
	// RuntimeHardening selects the restrictions applied to runtimes.
	RuntimeHardening hardening.Level
	// RuntimeNode describes the node binary runtimes launch with.
	RuntimeNode hardening.Node
	// RuntimeRulesPath is the egress rules runtimes load, as written by
	// egressrules.Ensure. Required when RuntimeHardening is LevelNode.
	RuntimeRulesPath string

	mu          sync.Mutex
	procs       map[string]*processState
	generations map[string]int64
	// lastActivity is the scale-to-zero activity clock, per instance.
	lastActivity map[string]time.Time
	// refCounts holds in-flight request counts, per instance.
	refCounts map[string]int
	// scaleToZeroModes caches whether a tracked instance's effective mode is
	// scale-to-zero, refreshed by the scale-to-zero scan; the admin import path
	// consults TracksInstance for warmth.
	scaleToZeroModes map[string]bool
	// stzIdleTTL and stzMaxWarm are set by StartScaleToZeroLoop.
	stzIdleTTL time.Duration
	stzMaxWarm int
	// counters accumulate scale-to-zero and reconcile events for the log surface.
	counters struct {
		ScaleToZeroColdStarts int64
		ScaleToZeroHotHits    int64
		ScaleToZeroIdleStops  int64
		ScaleToZeroLRUEvicted int64
		OrphansKilled         int64
		MissingRestarted      int64
		SurplusStopped        int64
		ReconcilePasses       int64
	}

	gates   map[string]*instanceGate
	gatesMu sync.Mutex

	// orphanGraceForTest overrides the reconcile grace window in tests; zero
	// keeps the production window. Not set by the daemon.
	orphanGraceForTest time.Duration

	lifecycleCtx    context.Context
	lifecycleCancel context.CancelFunc
	wg              sync.WaitGroup
	restartDelay    func(int) time.Duration
}

type CreateInstanceRequest struct {
	ID        string          `json:"id"`
	ServiceID string          `json:"service_id"`
	Name      string          `json:"name"`
	Config    json.RawMessage `json:"config"`
	Secret    json.RawMessage `json:"secret"`
	Start     bool            `json:"start"`
	// RuntimeMode overrides the Service mode for this instance; empty inherits.
	RuntimeMode domain.RuntimeMode `json:"runtime_mode"`
}

type processState struct {
	cmd        *exec.Cmd
	done       chan struct{}
	attempt    int
	generation int64
}

func New(dataDir string, st *store.Store) *Supervisor {
	if abs, err := filepath.Abs(dataDir); err == nil {
		dataDir = abs
	}
	lifecycleCtx, lifecycleCancel := context.WithCancel(context.Background())
	return &Supervisor{
		DataDir:          dataDir,
		Store:            st,
		Logger:           daemonlog.Nop(),
		procs:            map[string]*processState{},
		generations:      map[string]int64{},
		lastActivity:     map[string]time.Time{},
		refCounts:        map[string]int{},
		scaleToZeroModes: map[string]bool{},
		lifecycleCtx:     lifecycleCtx,
		lifecycleCancel:  lifecycleCancel,
		restartDelay:     backoff,
	}
}

// CreateInstance creates an instance, or converges one that already exists.
// A repeated call from a package sync with unchanged config/secret/name/mode
// is a read: it returns the stored instance and touches no process. When
// something changed, the row is updated (preserving operator state:
// Enabled, Status, PID, CreatedAt) and the resident process is restarted to
// load the new content. Sync updates what the package defines; it never flips
// operator intent.
func (s *Supervisor) CreateInstance(ctx context.Context, req CreateInstanceRequest) (domain.Instance, error) {
	if err := domain.ValidateID("instance", req.ID); err != nil {
		return domain.Instance{}, err
	}
	if err := domain.ValidateInstanceRuntimeMode(req.RuntimeMode); err != nil {
		return domain.Instance{}, err
	}
	svc, err := s.Store.GetService(ctx, req.ServiceID)
	if err != nil {
		return domain.Instance{}, err
	}
	config := []byte(req.Config)
	if len(config) == 0 {
		config = []byte(`{}`)
	}
	secret := []byte(req.Secret)
	if len(secret) == 0 {
		secret = []byte(`{}`)
	}
	if err := validateConfigSchema(svc.ConfigSchemaPath, config); err != nil {
		return domain.Instance{}, err
	}
	if err := validateSecretSchema(svc.SecretSchemaPath, secret); err != nil {
		return domain.Instance{}, err
	}

	unlock := s.lockInstance(req.ID)
	defer unlock()

	configHash := domain.ConfigHash(config)
	secretHash := domain.HashBytes(secret)
	existing, getErr := s.Store.GetInstance(ctx, req.ID)
	if getErr == nil {
		// The instance exists. Decide whether the request changes anything the
		// process consumes.
		name := req.Name
		if name == "" {
			name = req.ID
		}
		modeChanged := existing.RuntimeMode != req.RuntimeMode
		contentChanged := existing.ConfigSHA256 != configHash ||
			existing.SecretSHA256 != secretHash ||
			existing.NodeEntry != svc.NodeEntry ||
			existing.ServiceID != req.ServiceID
		cosmeticChanged := existing.Name != name
		if !modeChanged && !contentChanged && !cosmeticChanged {
			s.logger().Info("instance_create_noop", "instance_id", req.ID, "service_id", req.ServiceID)
			return existing, nil
		}

		// Preserve operator state from the existing row.
		merged := existing
		merged.ServiceID = req.ServiceID
		merged.Name = name
		merged.NodeEntry = svc.NodeEntry
		merged.RuntimeMode = req.RuntimeMode
		merged.ConfigJSON = config
		merged.ConfigSHA256 = configHash
		merged.SecretJSON = secret
		merged.SecretSHA256 = secretHash

		effectiveBefore := domain.EffectiveRuntimeMode(svc, existing)
		effectiveAfter := domain.EffectiveRuntimeMode(svc, merged)

		s.mu.Lock()
		tracked := s.procs[req.ID] != nil
		s.mu.Unlock()

		// A mode change into on-demand must not leave a resident process
		// behind; every other transition is handled after the row write. A
		// stop that times out (the process is stuck dying) still commits the
		// intent: normalize the row to on-demand's resting state so the
		// gateway sees a servable instance, and report the stop failure -- the
		// reconcile pass owns the leftover process from here.
		if effectiveAfter == domain.RuntimeModeOnDemand && effectiveBefore != domain.RuntimeModeOnDemand {
			s.mu.Lock()
			s.nextGenerationLocked(req.ID)
			s.mu.Unlock()
			if tracked || existing.PID != nil {
				if err := s.stopProcess(ctx, existing, true); err != nil {
					if normErr := s.normalizeStaticModeRow(ctx, req.ID, domain.RuntimeModeOnDemand); normErr != nil {
						return domain.Instance{}, fmt.Errorf("stop resident process before switching to on-demand: %w (normalize failed: %v)", err, normErr)
					}
					s.writeInstanceConfig(req.ID, config)
					return domain.Instance{}, fmt.Errorf("stop resident process before switching to on-demand: %w", err)
				}
			}
		}

		if err := s.Store.UpsertInstance(ctx, merged); err != nil {
			return domain.Instance{}, err
		}
		if err := s.writeInstanceConfig(req.ID, config); err != nil {
			return domain.Instance{}, err
		}
		s.logger().Info("instance_create_updated", "instance_id", req.ID, "service_id", req.ServiceID, "runtime_mode", effectiveAfter, "mode_changed", modeChanged, "content_changed", contentChanged)

		switch {
		case effectiveBefore == effectiveAfter:
			// Same mode, new content: a live resident process must reload.
			if effectiveAfter != domain.RuntimeModeOnDemand && (tracked || existing.PID != nil) {
				if err := s.restartLocked(ctx, req.ID, merged.Enabled); err != nil {
					return s.Store.GetInstance(ctx, req.ID)
				}
			}
		case effectiveAfter == domain.RuntimeModeOnDemand:
			// Resident stopped above; normalize the row to the logical
			// on-demand state.
			if err := s.normalizeStaticModeRow(ctx, req.ID, domain.RuntimeModeOnDemand); err != nil {
				return domain.Instance{}, err
			}
		case effectiveBefore == domain.RuntimeModeOnDemand:
			// Entering a resident mode: start if the operator had it enabled.
			// On-demand rows are always enabled with no process, so the row's
			// Enabled reflects the last operator start/stop.
			if merged.Enabled {
				if err := s.startLocked(ctx, req.ID); err != nil {
					failed, getErr := s.Store.GetInstance(ctx, req.ID)
					if getErr != nil {
						return domain.Instance{}, err
					}
					return failed, err
				}
			}
		case effectiveBefore == domain.RuntimeModeLongRunning && effectiveAfter == domain.RuntimeModeScaleToZero:
			// A warm long-running instance is already the warm state scale-to-zero
			// wants; nothing to do.
		case effectiveBefore == domain.RuntimeModeScaleToZero && effectiveAfter == domain.RuntimeModeLongRunning:
			// Warm: keep running. Cold and enabled: scale-to-zero rows sit enabled-
			// stopped, so start them to honor long-running's resident promise.
			if merged.Enabled && existing.PID == nil && !tracked {
				if err := s.startLocked(ctx, req.ID); err != nil {
					failed, getErr := s.Store.GetInstance(ctx, req.ID)
					if getErr != nil {
						return domain.Instance{}, err
					}
					return failed, err
				}
			}
		}
		return s.Store.GetInstance(ctx, req.ID)
	}
	if !errors.Is(getErr, sql.ErrNoRows) {
		return domain.Instance{}, getErr
	}

	// Genuinely new instance: the legacy create path.
	start := req.Start
	status := domain.StatusStopped
	enabled := start
	effectiveNew := domain.EffectiveRuntimeMode(svc, domain.Instance{RuntimeMode: req.RuntimeMode})
	switch effectiveNew {
	case domain.RuntimeModeOnDemand:
		// On-demand needs no process to serve: created enabled and logically
		// running with no pid.
		start = false
		enabled = true
		status = domain.StatusRunning
	case domain.RuntimeModeScaleToZero:
		// Scale-to-zero serves from cold: created enabled, stopped, started by the
		// first call. req.Start would warm it immediately, which defeats the
		// mode for bulk syncs; the explicit admin Start still warms.
		start = false
		enabled = true
	}
	inst := domain.Instance{ID: req.ID, ServiceID: req.ServiceID, Name: req.Name, Enabled: enabled, Status: status, RuntimeMode: req.RuntimeMode, NodeEntry: svc.NodeEntry, ConfigJSON: config, ConfigSHA256: configHash, SecretJSON: secret, SecretSHA256: secretHash}
	if inst.Name == "" {
		inst.Name = req.ID
	}
	if start {
		inst.Status = domain.StatusStarting
	}
	if err := s.writeInstanceConfig(req.ID, config); err != nil {
		return domain.Instance{}, err
	}
	if err := s.Store.UpsertInstance(ctx, inst); err != nil {
		return domain.Instance{}, err
	}
	s.logger().Info("instance_create", "instance_id", inst.ID, "service_id", inst.ServiceID, "runtime_mode", domain.EffectiveRuntimeMode(svc, inst), "start", req.Start)
	if start {
		if err := s.startLocked(ctx, req.ID); err != nil {
			failed, getErr := s.Store.GetInstance(ctx, req.ID)
			if getErr != nil {
				return domain.Instance{}, err
			}
			return failed, err
		}
	}
	return s.Store.GetInstance(ctx, req.ID)
}

func (s *Supervisor) UpdateSecret(ctx context.Context, instanceID string, secret []byte, restart bool) (domain.Instance, error) {
	unlock := s.lockInstance(instanceID)
	defer unlock()
	inst, err := s.Store.GetInstance(ctx, instanceID)
	if err != nil {
		return domain.Instance{}, err
	}
	if len(secret) == 0 {
		secret = []byte(`{}`)
	}
	svc, err := s.Store.GetService(ctx, inst.ServiceID)
	if err != nil {
		return domain.Instance{}, err
	}
	if err := validateSecretSchema(svc.SecretSchemaPath, secret); err != nil {
		return domain.Instance{}, err
	}
	inst.SecretJSON = secret
	inst.SecretSHA256 = domain.HashBytes(secret)
	if err := s.Store.UpsertInstance(ctx, inst); err != nil {
		return domain.Instance{}, err
	}
	s.logger().Info("instance_secret_updated", "instance_id", instanceID, "secret_sha256", inst.SecretSHA256, "restart", restart)
	if restart {
		if err := s.rejectOnDemandRuntimeControl(ctx, inst); err != nil {
			return domain.Instance{}, err
		}
		if err := s.restartLocked(ctx, instanceID, inst.Enabled); err != nil {
			return domain.Instance{}, err
		}
	}
	return s.Store.GetInstance(ctx, instanceID)
}

func (s *Supervisor) UpdateConfig(ctx context.Context, instanceID string, config []byte, restart bool) (domain.Instance, error) {
	unlock := s.lockInstance(instanceID)
	defer unlock()
	inst, err := s.Store.GetInstance(ctx, instanceID)
	if err != nil {
		return domain.Instance{}, err
	}
	if len(config) == 0 {
		config = []byte(`{}`)
	}
	svc, err := s.Store.GetService(ctx, inst.ServiceID)
	if err != nil {
		return domain.Instance{}, err
	}
	if err := validateConfigSchema(svc.ConfigSchemaPath, config); err != nil {
		return domain.Instance{}, err
	}
	if err := s.writeInstanceConfig(instanceID, config); err != nil {
		return domain.Instance{}, err
	}
	inst.ConfigJSON = config
	inst.ConfigSHA256 = domain.ConfigHash(config)
	if err := s.Store.UpsertInstance(ctx, inst); err != nil {
		return domain.Instance{}, err
	}
	s.logger().Info("instance_config_updated", "instance_id", instanceID, "config_sha256", inst.ConfigSHA256, "restart", restart)
	if restart {
		if err := s.rejectOnDemandRuntimeControl(ctx, inst); err != nil {
			return domain.Instance{}, err
		}
		if err := s.restartLocked(ctx, instanceID, inst.Enabled); err != nil {
			return domain.Instance{}, err
		}
	}
	return s.Store.GetInstance(ctx, instanceID)
}

func (s *Supervisor) Start(ctx context.Context, instanceID string) error {
	unlock := s.lockInstance(instanceID)
	defer unlock()
	return s.startLocked(ctx, instanceID)
}

func (s *Supervisor) startWithAttempt(ctx context.Context, instanceID string, restartAttempt int, generation int64) error {
	ctx, finishOperation, err := s.beginOperation(ctx)
	if err != nil {
		return err
	}
	defer finishOperation()
	inst, err := s.Store.GetInstance(ctx, instanceID)
	if err != nil {
		return err
	}
	svc, err := s.Store.GetService(ctx, inst.ServiceID)
	if err != nil {
		return err
	}
	logger := s.logger()
	attempt := restartAttempt + 1
	logger.Info("instance_starting", "instance_id", instanceID, "service_id", inst.ServiceID, "attempt", attempt)
	var startErr error
	defer func() {
		if startErr != nil {
			logger.Error("instance_start_failed", "instance_id", instanceID, "attempt", attempt, "error", startErr)
		}
	}()
	if domain.EffectiveRuntimeMode(svc, inst) == domain.RuntimeModeOnDemand {
		startErr = ErrUnsupportedRuntimeControl
		return ErrUnsupportedRuntimeControl
	}
	if err := s.writeInstanceConfig(instanceID, inst.ConfigJSON); err != nil {
		startErr = err
		return err
	}
	addr, port, err := freeLocalPort()
	if err != nil {
		startErr = err
		return err
	}
	workdir := s.InstanceWorkdir(instanceID)
	entry := filepath.Join(s.ServiceRuntimeDir(svc.ID), svc.NodeEntry)
	info, err := os.Stat(entry)
	if err != nil {
		startErr = fmt.Errorf("runtime entry %q is not available: %w", svc.NodeEntry, err)
		return startErr
	}
	if !info.Mode().IsRegular() {
		startErr = fmt.Errorf("runtime entry %q is not a regular file", svc.NodeEntry)
		return startErr
	}
	secretFile, closeSecret, err := secretReadFile(inst.SecretJSON)
	if err != nil {
		startErr = err
		return err
	}
	defer closeSecret()
	cmd := exec.Command(entry, "--runtime", "serve", "--host", "127.0.0.1", "--port", fmt.Sprintf("%d", port), "--config", filepath.Join(workdir, "config.json"), "--secret-fd", "3", "--workdir", workdir, "--service", svc.ID, "--instance", instanceID)
	cmd.Dir = workdir
	cmd.ExtraFiles = []*os.File{secretFile}
	if err := hardening.Apply(cmd, hardening.Spec{
		Level:      s.RuntimeHardening,
		Node:       s.RuntimeNode,
		RulesPath:  s.RuntimeRulesPath,
		ServiceDir: filepath.Dir(s.ServiceRuntimeDir(svc.ID)),
		Workdir:    workdir,
		// package/ and runtime/ may be symlinks into the shared runtime tree
		// store, and Node's permission model checks realpaths: without a read
		// grant for the tree the runtime dies on startup. The grant is the
		// resolved tree, not the whole store: other services' trees hold their
		// code and dependencies, and a compromised runtime has no business
		// reading them. A running instance never sees its link repointed --
		// re-import swaps the tree and restarts the instance, which resolves
		// the grant afresh -- so resolving once at launch covers the whole
		// process lifetime.
		ExtraReadDirs: s.sharedTreeReadGrants(svc.ID),
		Env: []string{
			"OCTOBUS_SERVICE_ID=" + svc.ID,
			"OCTOBUS_INSTANCE_ID=" + instanceID,
			"OCTOBUS_PACKAGE_DIR=" + filepath.Join(s.ServiceRuntimeDir(svc.ID), filepath.FromSlash(svc.ServiceRoot)),
			"OCTOBUS_DESCRIPTOR_PATH=" + svc.DescriptorPath,
			"OCTOBUS_DESCRIPTOR_SHA256=" + svc.DescriptorSHA256,
		},
	}); err != nil {
		startErr = err
		return err
	}
	stdout, err := os.OpenFile(filepath.Join(workdir, "stdout.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		startErr = err
		return err
	}
	stderr, err := os.OpenFile(filepath.Join(workdir, "stderr.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		_ = stdout.Close()
		startErr = err
		return err
	}
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	inst.Enabled = true
	inst.Status = domain.StatusStarting
	inst.ListenAddr = addr
	if err := s.Store.UpsertInstance(ctx, inst); err != nil {
		_ = stdout.Close()
		_ = stderr.Close()
		startErr = err
		return err
	}
	if err := cmd.Start(); err != nil {
		_ = stdout.Close()
		_ = stderr.Close()
		inst.Status = domain.StatusFailed
		_ = s.Store.UpsertInstance(ctx, inst)
		startErr = err
		return err
	}
	pid := cmd.Process.Pid
	inst.PID = &pid
	inst.Status = domain.StatusRunning
	if err := s.Store.UpsertInstance(ctx, inst); err != nil {
		_ = hardening.Kill(cmd)
		_ = cmd.Wait()
		hardening.KillGroup(cmd)
		_ = stdout.Close()
		_ = stderr.Close()
		startErr = err
		return err
	}
	logger.Info("instance_started", "instance_id", instanceID, "pid", pid, "listen_addr", addr)
	state := &processState{cmd: cmd, done: make(chan struct{}), attempt: restartAttempt, generation: generation}
	s.mu.Lock()
	if err := s.lifecycleErrLocked(); err != nil {
		s.mu.Unlock()
		s.cleanupFailedStart(instanceID, state, stdout, stderr)
		_ = s.persistStoppedInstance(ctx, inst, true)
		startErr = err
		return err
	}
	// Defense in depth: the gate serializes start and stop, so an entry left
	// here means a caller bypassed the gate -- the exact overwrite that leaked
	// processes before the gate existed. Kill the replaced process instead of
	// orphaning it, and fail the start: the state is inconsistent enough that
	// a clean retry is safer than continuing.
	previous := s.procs[instanceID]
	if previous != nil && previous != state {
		s.mu.Unlock()
		logger.Warn("instance_start_replaced_tracked_process", "instance_id", instanceID, "previous_pid", processPID(previous.cmd))
		_ = hardening.Kill(previous.cmd)
		_ = previous.cmd.Wait()
		hardening.KillGroup(previous.cmd)
		close(previous.done)
		s.mu.Lock()
		if s.procs[instanceID] == previous {
			delete(s.procs, instanceID)
		}
		s.mu.Unlock()
		s.cleanupFailedStart(instanceID, state, stdout, stderr)
		_ = s.persistStoppedInstance(ctx, inst, true)
		startErr = errors.New("start replaced an existing tracked process")
		return startErr
	}
	s.procs[instanceID] = state
	// The idle clock starts when the process becomes tracked, not when the
	// first request arrives: an admin Start, a Restart, a content-changing
	// create, a mode switch that keeps the process, or recovery must all buy
	// the instance a full idle TTL, not one scan interval.
	s.lastActivity[instanceID] = time.Now()
	s.mu.Unlock()
	if err := waitHealth(ctx, addr, 5*time.Second); err != nil {
		if ctx.Err() != nil && s.lifecycleErr() != nil {
			_ = s.persistStoppedInstance(ctx, inst, true)
		} else {
			inst.Status = domain.StatusFailed
			_ = s.Store.UpsertInstance(ctx, inst)
		}
		s.cleanupFailedStart(instanceID, state, stdout, stderr)
		logger.Warn("instance_health_failed", "instance_id", instanceID, "listen_addr", addr, "error", err)
		startErr = err
		return err
	}
	logger.Info("instance_health_ready", "instance_id", instanceID, "listen_addr", addr)
	s.mu.Lock()
	if s.procs[instanceID] != state {
		s.mu.Unlock()
		s.cleanupFailedStart(instanceID, state, stdout, stderr)
		_ = s.persistStoppedInstance(ctx, inst, true)
		startErr = context.Canceled
		return startErr
	}
	if err := s.lifecycleErrLocked(); err != nil {
		s.mu.Unlock()
		s.cleanupFailedStart(instanceID, state, stdout, stderr)
		_ = s.persistStoppedInstance(ctx, inst, true)
		startErr = err
		return err
	}
	s.wg.Add(1)
	s.mu.Unlock()
	s.notifyInstanceChanged(instanceID)
	go func() {
		defer s.wg.Done()
		s.wait(instanceID, state, stdout, stderr)
	}()
	return nil
}

func (s *Supervisor) cleanupFailedStart(instanceID string, state *processState, stdout, stderr *os.File) {
	s.mu.Lock()
	if s.procs[instanceID] == state {
		delete(s.procs, instanceID)
	}
	s.mu.Unlock()
	if state.cmd.Process != nil {
		_ = hardening.Kill(state.cmd)
		_ = state.cmd.Wait()
		hardening.KillGroup(state.cmd)
	}
	close(state.done)
	_ = stdout.Close()
	_ = stderr.Close()
}

func (s *Supervisor) Stop(ctx context.Context, instanceID string) error {
	unlock := s.lockInstance(instanceID)
	defer unlock()
	inst, err := s.Store.GetInstance(ctx, instanceID)
	if err != nil {
		return err
	}
	if err := s.rejectOnDemandRuntimeControl(ctx, inst); err != nil {
		return err
	}
	return s.stopProcess(ctx, inst, false)
}

func (s *Supervisor) Shutdown(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}
	logger := s.logger()
	logger.Info("supervisor_shutdown_started")
	ids := map[string]struct{}{}
	s.mu.Lock()
	if s.lifecycleCancel != nil {
		s.lifecycleCancel()
	}
	for id := range s.procs {
		ids[id] = struct{}{}
	}
	for id := range s.generations {
		ids[id] = struct{}{}
		s.nextGenerationLocked(id)
	}
	s.mu.Unlock()

	instances, err := s.Store.ListInstances(ctx)
	var errs []error
	if err != nil {
		errs = append(errs, fmt.Errorf("list instances for supervisor shutdown: %w", err))
	} else {
		for _, inst := range instances {
			svc, getErr := s.Store.GetService(ctx, inst.ServiceID)
			if getErr != nil {
				errs = append(errs, fmt.Errorf("%s: get service for supervisor shutdown: %w", inst.ID, getErr))
				continue
			}
			if shouldStopOnShutdown(inst, svc) {
				ids[inst.ID] = struct{}{}
			}
		}
	}

	errs = append(errs, RunBounded(sortedKeys(ids), 4, func(id string) error {
		inst, getErr := s.Store.GetInstance(ctx, id)
		if getErr != nil {
			return fmt.Errorf("%s: get instance for supervisor shutdown: %w", id, getErr)
		}
		svc, getErr := s.Store.GetService(ctx, inst.ServiceID)
		if getErr != nil {
			return fmt.Errorf("%s: get service for supervisor shutdown: %w", id, getErr)
		}
		mode := domain.EffectiveRuntimeMode(svc, inst)
		// Long-running keeps its resident promise to the last moment. Scale-to-
		// zero warm processes are stopped too: a resident process must not outlive
		// the daemon, but the row stays enabled so the next call re-warms it.
		if mode != domain.RuntimeModeLongRunning && mode != domain.RuntimeModeScaleToZero {
			return nil
		}
		if err := s.stopProcess(ctx, inst, inst.Enabled); err != nil {
			return fmt.Errorf("%s: stop process for supervisor shutdown: %w", id, err)
		}
		return nil
	})...)

	done := make(chan struct{})
	go func() {
		s.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-ctx.Done():
		errs = append(errs, ctx.Err())
	}
	err = errors.Join(errs...)
	if err != nil {
		logger.Warn("supervisor_shutdown_failed", "error", err)
		return err
	}
	logger.Info("supervisor_shutdown_done")
	return nil
}

func (s *Supervisor) Restart(ctx context.Context, instanceID string) error {
	unlock := s.lockInstance(instanceID)
	defer unlock()
	inst, err := s.Store.GetInstance(ctx, instanceID)
	if err != nil {
		return err
	}
	if err := s.rejectOnDemandRuntimeControl(ctx, inst); err != nil {
		return err
	}
	s.logger().Info("instance_restart_requested", "instance_id", instanceID)
	wasEnabled := inst.Enabled
	if err := s.stopProcess(ctx, inst, wasEnabled); err != nil {
		return err
	}
	if !wasEnabled {
		inst.Enabled = false
		inst.Status = domain.StatusStopped
		inst.PID = nil
		if err := s.Store.UpsertInstance(ctx, inst); err != nil {
			return err
		}
		s.notifyInstanceChanged(instanceID)
		return nil
	}
	return s.startLocked(ctx, instanceID)
}

// SetRuntimeMode changes an instance's mode override ("" inherits the Service
// mode). It only acts when the effective mode changes: a running resident
// process must be stopped before the instance can be served on demand, and an
// instance that becomes long-running again must be started when it is enabled.
// Scale-to-zero transitions keep a warm process warm: scale-to-zero is a
// superset of long-running's resident behavior with a parking policy.
func (s *Supervisor) SetRuntimeMode(ctx context.Context, instanceID string, mode domain.RuntimeMode) (domain.Instance, error) {
	if err := domain.ValidateInstanceRuntimeMode(mode); err != nil {
		return domain.Instance{}, err
	}
	ctx, finishOperation, err := s.beginOperation(ctx)
	if err != nil {
		return domain.Instance{}, err
	}
	defer finishOperation()
	unlock := s.lockInstance(instanceID)
	defer unlock()
	inst, err := s.Store.GetInstance(ctx, instanceID)
	if err != nil {
		return domain.Instance{}, err
	}
	svc, err := s.Store.GetService(ctx, inst.ServiceID)
	if err != nil {
		return domain.Instance{}, err
	}
	before := domain.EffectiveRuntimeMode(svc, inst)
	previousMode := inst.RuntimeMode
	after := mode
	if after == "" {
		after = svc.RuntimeMode
		if after == "" {
			after = domain.RuntimeModeLongRunning
		}
	}
	// Refresh the scale-to-zero cache before any branch returns: the scan
	// refreshes it on its own period, and a stale entry would let one scan
	// treat a freshly non-scale-to-zero (or freshly scale-to-zero) tracked
	// instance under the old mode. Some branches below return early; they must
	// not skip this.
	s.mu.Lock()
	s.scaleToZeroModes[instanceID] = after == domain.RuntimeModeScaleToZero
	s.mu.Unlock()
	if before == after {
		inst.RuntimeMode = mode
		if err := s.Store.UpsertInstance(ctx, inst); err != nil {
			return domain.Instance{}, err
		}
		inst, err = s.Store.GetInstance(ctx, instanceID)
		if err != nil {
			return domain.Instance{}, err
		}
		// Make a repeated switch idempotent: a previous attempt may have
		// written the override and then failed to start (or stop) the process.
		s.mu.Lock()
		tracked := s.procs[instanceID] != nil
		s.mu.Unlock()
		startable := inst.Status == domain.StatusRunning || inst.Status == domain.StatusStopped ||
			inst.Status == domain.StatusFailed || inst.Status == domain.StatusDegraded
		switch {
		case after == domain.RuntimeModeLongRunning && inst.Enabled && inst.PID == nil && !tracked && startable:
			if err := s.startLocked(ctx, instanceID); err != nil {
				return inst, err
			}
			return s.Store.GetInstance(ctx, instanceID)
		case after == domain.RuntimeModeOnDemand && (inst.PID != nil || tracked):
			if err := s.stopProcess(ctx, inst, true); err != nil {
				return domain.Instance{}, err
			}
			inst, err = s.Store.GetInstance(ctx, instanceID)
			if err != nil {
				return domain.Instance{}, err
			}
			inst.Enabled = true
			inst.Status = domain.StatusRunning
			inst.PID = nil
			inst.ListenAddr = ""
			if err := s.Store.UpsertInstance(ctx, inst); err != nil {
				return domain.Instance{}, err
			}
			s.notifyInstanceChanged(instanceID)
		}
		return inst, nil
	}
	switch {
	case before == domain.RuntimeModeLongRunning && after == domain.RuntimeModeOnDemand:
		s.mu.Lock()
		s.nextGenerationLocked(instanceID)
		s.mu.Unlock()
		if err := s.stopProcess(ctx, inst, true); err != nil {
			// Commit the switch anyway: a stuck-dying process is the reconcile
			// pass's business from here, and the row must land in on-demand's
			// servable state rather than blocking every call behind it. Never
			// write the pre-stop snapshot back: it still claims the old mode,
			// running status, and a pid for a process that is no longer
			// tracked.
			if normErr := s.normalizeStaticModeRow(ctx, instanceID, domain.RuntimeModeOnDemand); normErr != nil {
				return domain.Instance{}, fmt.Errorf("stop resident process before switching to on-demand: %w (normalize failed: %v)", err, normErr)
			}
			return domain.Instance{}, fmt.Errorf("stop resident process before switching to on-demand: %w", err)
		}
		inst, err = s.Store.GetInstance(ctx, instanceID)
		if err != nil {
			return domain.Instance{}, err
		}
		inst.RuntimeMode = mode
		inst.Enabled = true
		inst.Status = domain.StatusRunning
		inst.PID = nil
		inst.ListenAddr = ""
	case before == domain.RuntimeModeOnDemand && after == domain.RuntimeModeLongRunning:
		inst.RuntimeMode = mode
		if err := s.Store.UpsertInstance(ctx, inst); err != nil {
			return domain.Instance{}, err
		}
		inst, err = s.Store.GetInstance(ctx, instanceID)
		if err != nil {
			return domain.Instance{}, err
		}
		if inst.Enabled {
			if startErr := s.startLocked(ctx, instanceID); startErr != nil {
				// The switch has not completed. Restore the previous override and
				// the logical on-demand state so the failed request does not leave
				// the instance marked long-running without a process.
				current, getErr := s.Store.GetInstance(ctx, instanceID)
				if getErr == nil {
					s.mu.Lock()
					tracked := s.procs[instanceID] != nil
					s.mu.Unlock()
					if tracked || current.PID != nil {
						_ = s.stopProcess(ctx, current, true)
						if reloaded, reloadErr := s.Store.GetInstance(ctx, instanceID); reloadErr == nil {
							current = reloaded
						}
					}
					current.RuntimeMode = previousMode
					current.Enabled = true
					current.Status = domain.StatusRunning
					current.PID = nil
					current.ListenAddr = ""
					if saveErr := s.Store.UpsertInstance(ctx, current); saveErr == nil {
						inst = current
						s.notifyInstanceChanged(instanceID)
					} else {
						s.logger().Error("runtime mode rollback failed", "instance_id", instanceID, "error", saveErr)
					}
				}
				return inst, startErr
			}
			return s.Store.GetInstance(ctx, instanceID)
		}
	case before == domain.RuntimeModeLongRunning && after == domain.RuntimeModeScaleToZero:
		// Keep a warm process warm: scale-to-zero parks it on idle instead of never.
		inst.RuntimeMode = mode
	case before == domain.RuntimeModeScaleToZero && after == domain.RuntimeModeLongRunning:
		inst.RuntimeMode = mode
		if err := s.Store.UpsertInstance(ctx, inst); err != nil {
			return domain.Instance{}, err
		}
		inst, err = s.Store.GetInstance(ctx, instanceID)
		if err != nil {
			return domain.Instance{}, err
		}
		// Long-running promises a resident process. Warm stays warm; cold and
		// enabled must start (a scale-to-zero row parks enabled-stopped).
		if inst.Enabled && inst.PID == nil {
			if err := s.startLocked(ctx, instanceID); err != nil {
				return inst, err
			}
		}
		return s.Store.GetInstance(ctx, instanceID)
	case before == domain.RuntimeModeOnDemand && after == domain.RuntimeModeScaleToZero:
		// Normalize the fake-running row to scale-to-zero's cold state; the first call
		// warms it through the gateway's EnsureStarted.
		inst.RuntimeMode = mode
		inst.Enabled = true
		inst.Status = domain.StatusStopped
		inst.PID = nil
		inst.ListenAddr = ""
	case before == domain.RuntimeModeScaleToZero && after == domain.RuntimeModeOnDemand:
		s.mu.Lock()
		s.nextGenerationLocked(instanceID)
		s.mu.Unlock()
		if err := s.stopProcess(ctx, inst, true); err != nil {
			return domain.Instance{}, fmt.Errorf("stop resident process before switching to on-demand: %w", err)
		}
		inst, err = s.Store.GetInstance(ctx, instanceID)
		if err != nil {
			return domain.Instance{}, err
		}
		inst.RuntimeMode = mode
		inst.Enabled = true
		inst.Status = domain.StatusRunning
		inst.PID = nil
		inst.ListenAddr = ""
	default:
		inst.RuntimeMode = mode
	}
	if err := s.Store.UpsertInstance(ctx, inst); err != nil {
		return domain.Instance{}, err
	}
	s.notifyInstanceChanged(instanceID)
	s.logger().Info("instance_runtime_mode_changed", "instance_id", instanceID, "before", before, "after", after, "override", mode)
	return s.Store.GetInstance(ctx, instanceID)
}

// ApplyServiceRuntimeMode reconciles an instance after its Service's mode
// changed. An instance that is now effectively on-demand must not keep a
// resident process; one that stays resident (long-running or scale-to-zero) is left
// alone here (the import path restarts long-running ones separately, and a
// warm scale-to-zero process is exactly what the mode wants).
func (s *Supervisor) ApplyServiceRuntimeMode(ctx context.Context, instanceID string) error {
	ctx, finishOperation, err := s.beginOperation(ctx)
	if err != nil {
		return err
	}
	defer finishOperation()
	unlock := s.lockInstance(instanceID)
	defer unlock()
	inst, err := s.Store.GetInstance(ctx, instanceID)
	if err != nil {
		return err
	}
	svc, err := s.Store.GetService(ctx, inst.ServiceID)
	if err != nil {
		return err
	}
	if domain.EffectiveRuntimeMode(svc, inst) != domain.RuntimeModeOnDemand {
		return nil
	}
	s.mu.Lock()
	s.nextGenerationLocked(instanceID)
	tracked := s.procs[instanceID] != nil
	s.mu.Unlock()
	if inst.PID != nil || tracked {
		if err := s.stopProcess(ctx, inst, true); err != nil {
			return fmt.Errorf("stop resident process after service switched to on-demand: %w", err)
		}
	}
	inst, err = s.Store.GetInstance(ctx, instanceID)
	if err != nil {
		return err
	}
	inst.Enabled = true
	inst.Status = domain.StatusRunning
	inst.PID = nil
	inst.ListenAddr = ""
	if err := s.Store.UpsertInstance(ctx, inst); err != nil {
		return err
	}
	s.notifyInstanceChanged(instanceID)
	return nil
}

func (s *Supervisor) DeleteInstance(ctx context.Context, instanceID string) error {
	unlock := s.lockInstance(instanceID)
	defer unlock()
	inst, err := s.Store.GetInstance(ctx, instanceID)
	if err != nil {
		return err
	}
	svc, err := s.Store.GetService(ctx, inst.ServiceID)
	if err != nil {
		return err
	}
	if domain.EffectiveRuntimeMode(svc, inst) == domain.RuntimeModeOnDemand {
		if err := s.Store.DeleteInstance(ctx, instanceID); err != nil {
			return err
		}
		s.logger().Info("instance_delete", "instance_id", instanceID)
		return nil
	}
	if err := s.stopProcess(ctx, inst, false); err != nil {
		return err
	}
	if err := s.Store.DeleteInstance(ctx, instanceID); err != nil {
		return err
	}
	s.logger().Info("instance_delete", "instance_id", instanceID)
	return nil
}

func (s *Supervisor) rejectOnDemandRuntimeControl(ctx context.Context, inst domain.Instance) error {
	svc, err := s.Store.GetService(ctx, inst.ServiceID)
	if err != nil {
		return err
	}
	if domain.EffectiveRuntimeMode(svc, inst) == domain.RuntimeModeOnDemand {
		return ErrUnsupportedRuntimeControl
	}
	return nil
}

// normalizeStaticModeRow rewrites an instance's row into on-demand's resting
// state: enabled, logically running, no process. On-demand has no stopped
// state -- it serves without one -- so every path that stops a process while
// switching to on-demand must land the row here, or the gateway answers
// Unavailable until an import normalizes it.
//
// The target mode is a parameter, not a read from the row: both call sites
// fire before the mode switch has been committed to the row, so a row-based
// guard would see the old mode and silently do nothing. The gate must be held.
// normalizeStaticModeRow commits a switch to on-demand at the row level when
// the process stop did not complete cleanly: the target mode is persisted
// together with that mode's resting state (enabled, logically running, no
// process). Writing the status without the mode would strand the row as "old
// mode + running + no pid" -- servable by nobody, and the reconcile missing
// pass would restart the just-abandoned process under the old mode. The gate
// must be held. A non-on-demand target is a no-op.
func (s *Supervisor) normalizeStaticModeRow(ctx context.Context, instanceID string, target domain.RuntimeMode) error {
	if target != domain.RuntimeModeOnDemand {
		return nil
	}
	inst, err := s.Store.GetInstance(ctx, instanceID)
	if err != nil {
		return err
	}
	inst.RuntimeMode = target
	inst.Enabled = true
	inst.Status = domain.StatusRunning
	inst.PID = nil
	inst.ListenAddr = ""
	if err := s.Store.UpsertInstance(ctx, inst); err != nil {
		return err
	}
	s.notifyInstanceChanged(instanceID)
	return nil
}

func (s *Supervisor) stopProcess(ctx context.Context, inst domain.Instance, enabled bool) error {
	if ctx == nil {
		ctx = context.Background()
	}
	logger := s.logger()
	logger.Info("instance_stopping", "instance_id", inst.ID)
	inst.Enabled = enabled
	inst.Status = domain.StatusStopped
	inst.PID = nil
	inst.ListenAddr = ""
	s.mu.Lock()
	s.nextGenerationLocked(inst.ID)
	state := s.procs[inst.ID]
	delete(s.procs, inst.ID)
	s.mu.Unlock()
	var stopErr error
	if state != nil && state.cmd.Process != nil {
		_ = hardening.Signal(state.cmd, os.Interrupt)
		if err := waitProcessDone(ctx, state.done, 2*time.Second); err != nil {
			_ = hardening.Kill(state.cmd)
			if killErr := waitProcessDone(ctx, state.done, 2*time.Second); killErr != nil {
				stopErr = killErr
			} else if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				stopErr = err
			}
		}
	}
	if err := s.persistStoppedInstance(ctx, inst, enabled); err != nil {
		logger.Error("instance_stop_failed", "instance_id", inst.ID, "error", err)
		return errors.Join(stopErr, err)
	}
	s.notifyInstanceChanged(inst.ID)
	logger.Info("instance_stopped", "instance_id", inst.ID)
	return stopErr
}

func (s *Supervisor) RecoverEnabled(ctx context.Context) (int, error) {
	rows, err := s.Store.DB().QueryContext(ctx, `
SELECT i.id
FROM instances i
JOIN services s ON s.id = i.service_id
WHERE i.enabled = 1
  AND (CASE WHEN i.runtime_mode <> '' THEN i.runtime_mode ELSE s.runtime_mode END) = ?
ORDER BY i.id`, string(domain.RuntimeModeLongRunning))
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return 0, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}
	errs := RunBounded(ids, 4, func(id string) error {
		if err := s.Start(ctx, id); err != nil {
			return fmt.Errorf("%s: %w", id, err)
		}
		return nil
	})
	return len(ids), errors.Join(errs...)
}

func RunBounded(ids []string, limit int, fn func(string) error) []error {
	if limit <= 0 {
		limit = 1
	}
	sem := make(chan struct{}, limit)
	errs := make([]error, len(ids))
	var wg sync.WaitGroup
	for i, id := range ids {
		i, id := i, id
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			errs[i] = fn(id)
		}()
	}
	wg.Wait()
	out := errs[:0]
	for _, err := range errs {
		if err != nil {
			out = append(out, err)
		}
	}
	return out
}

func (s *Supervisor) InstanceWorkdir(instanceID string) string {
	return filepath.Join(s.DataDir, "instances", instanceID)
}

func (s *Supervisor) ServiceRuntimeDir(serviceID string) string {
	return filepath.Join(s.DataDir, "artifacts", "services", serviceID, "runtime")
}

// sharedTreeReadGrants resolves the shared runtime trees this service's
// package/ and runtime/ entries point at, for the hardening read grant. See
// packageimport.SharedTreeReadGrants for the semantics.
func (s *Supervisor) sharedTreeReadGrants(serviceID string) []string {
	return packageimport.SharedTreeReadGrants(s.DataDir, serviceID)
}

func (s *Supervisor) writeInstanceConfig(instanceID string, config []byte) error {
	workdir := s.InstanceWorkdir(instanceID)
	if err := os.MkdirAll(workdir, 0o700); err != nil {
		return err
	}
	// On-demand invocations read this file while they start, so replace it
	// atomically: a truncating write would let a concurrent call decode a
	// partial JSON document.
	tmp, err := os.CreateTemp(workdir, ".config-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(config); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, filepath.Join(workdir, "config.json"))
}

func secretReadFile(secret []byte) (*os.File, func(), error) {
	if len(secret) == 0 {
		secret = []byte(`{}`)
	}
	reader, writer, err := os.Pipe()
	if err != nil {
		return nil, nil, err
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		_, _ = writer.Write(secret)
		_ = writer.Close()
	}()
	closeFn := func() {
		_ = reader.Close()
		_ = writer.Close()
		<-done
	}
	return reader, closeFn, nil
}

func (s *Supervisor) wait(instanceID string, state *processState, stdout, stderr *os.File) {
	err := state.cmd.Wait()
	hardening.KillGroup(state.cmd)
	_ = stdout.Close()
	_ = stderr.Close()
	close(state.done)
	// The row mutation below takes the instance gate: wait runs outside it, and
	// without the gate a request that EnsureStarted-queued during the crash
	// could warm a fresh process between the procs deletion and the row write
	// -- the stale degraded write would then destroy the new process's running
	// row and every request would fail with Unavailable until the idle scan
	// parked the instance. Holding the gate also re-checks ownership: a
	// successor (new tracked state) or a row whose pid is not this process's
	// means the world moved on and this exit owns nothing.
	unlock := s.lockInstance(instanceID)
	s.mu.Lock()
	current := s.procs[instanceID]
	if current == state {
		delete(s.procs, instanceID)
	}
	s.mu.Unlock()
	ctx := s.lifecycleContext()
	if ctx.Err() != nil {
		unlock()
		return
	}
	inst, getErr := s.Store.GetInstance(ctx, instanceID)
	if getErr != nil || !inst.Enabled || current != state || ctx.Err() != nil {
		unlock()
		return
	}
	// Ownership re-check under the gate: the row must still describe this
	// process. A successor's start already rewrote pid and status; writing
	// degraded over it would clobber a live generation.
	if inst.PID != nil && *inst.PID != processPID(state.cmd) {
		unlock()
		return
	}
	// A scale-to-zero instance whose process exits is degraded, not restarted:
	// restart-on-exit would fight the idle stopper and spin processes nobody is
	// calling. In-flight refs are dropped with the process -- only when no new
	// generation has started: a ref taken for a fresh process belongs to that
	// generation. A service lookup failure is treated as scale-to-zero too:
	// without a mode the safe answer is the one that cannot spin.
	svc, svcErr := s.Store.GetService(ctx, inst.ServiceID)
	if svcErr != nil || domain.EffectiveRuntimeMode(svc, inst) == domain.RuntimeModeScaleToZero {
		s.mu.Lock()
		if current == state {
			delete(s.refCounts, instanceID)
		}
		s.mu.Unlock()
		inst.Status = domain.StatusDegraded
		inst.PID = nil
		inst.ListenAddr = ""
		_ = s.Store.UpsertInstance(ctx, inst)
		s.notifyInstanceChanged(instanceID)
		s.logger().Warn("instance_degraded", "instance_id", instanceID, "attempt", state.attempt+1)
		unlock()
		return
	}
	s.logger().Warn("instance_exited", "instance_id", instanceID, "pid", processPID(state.cmd), "attempt", state.attempt+1, "error", err)
	inst.Status = domain.StatusDegraded
	inst.PID = nil
	_ = s.Store.UpsertInstance(ctx, inst)
	s.notifyInstanceChanged(instanceID)
	s.logger().Warn("instance_degraded", "instance_id", instanceID, "attempt", state.attempt+1)
	unlock()
	s.scheduleRestartAfterBackoff(instanceID, state.attempt+1, state.generation)
}

func (s *Supervisor) scheduleRestartAfterBackoff(instanceID string, attempt int, generation int64) {
	s.mu.Lock()
	if err := s.lifecycleErrLocked(); err != nil {
		s.mu.Unlock()
		return
	}
	s.wg.Add(1)
	s.mu.Unlock()
	go func() {
		defer s.wg.Done()
		s.restartAfterBackoff(instanceID, attempt, generation)
	}()
}

func (s *Supervisor) restartAfterBackoff(instanceID string, attempt int, generation int64) {
	ctx := s.lifecycleContext()
	delay := s.backoff(attempt)
	s.logger().Warn("instance_restart_scheduled", "instance_id", instanceID, "attempt", attempt+1, "delay", delay.String())
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return
	case <-timer.C:
	}
	if !s.generationMatches(instanceID, generation) {
		return
	}
	// Take the gate like every other start: an operator Start (or any lifecycle
	// operation) that lands while the backoff timer was sleeping serializes
	// here instead of racing startWithAttempt's proc registration. The
	// generation recheck inside the gate makes the operator's start win: it
	// bumped the generation, so this backoff attempt stands down.
	unlock := s.lockInstance(instanceID)
	if !s.generationMatches(instanceID, generation) {
		unlock()
		return
	}
	inst, err := s.Store.GetInstance(ctx, instanceID)
	if err != nil || !inst.Enabled {
		unlock()
		return
	}
	err = s.startWithAttempt(ctx, instanceID, attempt, generation)
	unlock()
	if err != nil {
		if ctx.Err() != nil || !s.generationMatches(instanceID, generation) {
			return
		}
		s.logger().Warn("instance_degraded", "instance_id", instanceID, "attempt", attempt+1)
		inst.Status = domain.StatusDegraded
		inst.PID = nil
		_ = s.Store.UpsertInstance(ctx, inst)
		s.notifyInstanceChanged(instanceID)
		s.scheduleRestartAfterBackoff(instanceID, attempt+1, generation)
	}
}

func (s *Supervisor) nextGenerationLocked(instanceID string) int64 {
	if s.generations == nil {
		s.generations = map[string]int64{}
	}
	s.generations[instanceID]++
	return s.generations[instanceID]
}

func (s *Supervisor) generationMatches(instanceID string, generation int64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.generations[instanceID] == generation
}

func (s *Supervisor) beginOperation(ctx context.Context) (context.Context, func(), error) {
	if ctx == nil {
		ctx = context.Background()
	}
	s.mu.Lock()
	if err := s.lifecycleErrLocked(); err != nil {
		s.mu.Unlock()
		return nil, nil, err
	}
	lifecycleCtx := s.lifecycleCtx
	if lifecycleCtx == nil {
		lifecycleCtx = context.Background()
	}
	opCtx, cancel := context.WithCancel(ctx)
	s.wg.Add(1)
	s.mu.Unlock()

	done := make(chan struct{})
	go func() {
		defer close(done)
		select {
		case <-lifecycleCtx.Done():
			cancel()
		case <-opCtx.Done():
		}
	}()
	finish := func() {
		cancel()
		<-done
		s.wg.Done()
	}
	return opCtx, finish, nil
}

func (s *Supervisor) lifecycleContext() context.Context {
	if s.lifecycleCtx == nil {
		return context.Background()
	}
	return s.lifecycleCtx
}

func (s *Supervisor) lifecycleErr() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lifecycleErrLocked()
}

func (s *Supervisor) lifecycleErrLocked() error {
	if s.lifecycleCtx == nil {
		return nil
	}
	return s.lifecycleCtx.Err()
}

func (s *Supervisor) backoff(attempt int) time.Duration {
	if s.restartDelay == nil {
		return backoff(attempt)
	}
	return s.restartDelay(attempt)
}

func (s *Supervisor) persistStoppedInstance(ctx context.Context, inst domain.Instance, enabled bool) error {
	inst.Enabled = enabled
	inst.Status = domain.StatusStopped
	inst.PID = nil
	inst.ListenAddr = ""
	storeCtx := ctx
	if storeCtx == nil {
		storeCtx = context.Background()
	}
	if storeCtx.Err() != nil {
		var cancel context.CancelFunc
		storeCtx, cancel = context.WithTimeout(context.Background(), time.Second)
		defer cancel()
	}
	return s.Store.UpsertInstance(storeCtx, inst)
}

func waitProcessDone(ctx context.Context, done <-chan struct{}, timeout time.Duration) error {
	if ctx == nil {
		ctx = context.Background()
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return errProcessStopTimeout
	}
}

func shouldStopOnShutdown(inst domain.Instance, svc domain.Service) bool {
	mode := domain.EffectiveRuntimeMode(svc, inst)
	if mode != domain.RuntimeModeLongRunning && mode != domain.RuntimeModeScaleToZero {
		return false
	}
	if inst.PID != nil {
		return true
	}
	if !inst.Enabled {
		return false
	}
	return inst.Status == domain.StatusStarting || inst.Status == domain.StatusRunning || inst.Status == domain.StatusDegraded || inst.Status == domain.StatusFailed
}

func sortedKeys(keys map[string]struct{}) []string {
	out := make([]string, 0, len(keys))
	for key := range keys {
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}

func (s *Supervisor) notifyInstanceChanged(instanceID string) {
	if s.OnInstanceChanged != nil {
		s.OnInstanceChanged(instanceID)
	}
}

func (s *Supervisor) logger() *slog.Logger {
	if s == nil {
		return daemonlog.Nop()
	}
	return daemonlog.OrNop(s.Logger)
}

func processPID(cmd *exec.Cmd) int {
	if cmd == nil || cmd.Process == nil {
		return 0
	}
	return cmd.Process.Pid
}

func backoff(attempt int) time.Duration {
	delays := []time.Duration{time.Second, 2 * time.Second, 5 * time.Second, 10 * time.Second, 30 * time.Second}
	if attempt <= 0 {
		return delays[0]
	}
	if attempt > len(delays) {
		return delays[len(delays)-1]
	}
	return delays[attempt-1]
}

func freeLocalPort() (string, int, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", 0, err
	}
	defer ln.Close()
	addr := ln.Addr().(*net.TCPAddr)
	return addr.String(), addr.Port, nil
}

func waitHealth(ctx context.Context, addr string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	var lastErr error
	for time.Now().Before(deadline) {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("instance health check failed at %s: %w", addr, err)
		}
		attemptCtx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
		conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
		if err == nil {
			client := grpc_health_v1.NewHealthClient(conn)
			resp, checkErr := client.Check(attemptCtx, &grpc_health_v1.HealthCheckRequest{Service: ""})
			_ = conn.Close()
			if checkErr == nil && resp.GetStatus() == grpc_health_v1.HealthCheckResponse_SERVING {
				cancel()
				return nil
			}
			lastErr = checkErr
		} else {
			lastErr = err
		}
		cancel()
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("instance health check failed at %s: %w", addr, err)
		}
		time.Sleep(100 * time.Millisecond)
	}
	if lastErr == nil {
		lastErr = context.DeadlineExceeded
	}
	return fmt.Errorf("instance health check failed at %s: %w", addr, lastErr)
}
