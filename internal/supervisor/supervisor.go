package supervisor

import (
	"context"
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

	mu          sync.Mutex
	procs       map[string]*processState
	generations map[string]int64

	lifecycleCtx    context.Context
	lifecycleCancel context.CancelFunc
	wg              sync.WaitGroup
	restartDelay    func(int) time.Duration
}

type processState struct {
	cmd        *exec.Cmd
	done       chan struct{}
	attempt    int
	generation int64
}

type CreateInstanceRequest struct {
	ID        string          `json:"id"`
	ServiceID string          `json:"service_id"`
	Name      string          `json:"name"`
	Config    json.RawMessage `json:"config"`
	Secret    json.RawMessage `json:"secret"`
	Start     bool            `json:"start"`
}

func New(dataDir string, st *store.Store) *Supervisor {
	if abs, err := filepath.Abs(dataDir); err == nil {
		dataDir = abs
	}
	lifecycleCtx, lifecycleCancel := context.WithCancel(context.Background())
	return &Supervisor{
		DataDir:         dataDir,
		Store:           st,
		Logger:          daemonlog.Nop(),
		procs:           map[string]*processState{},
		generations:     map[string]int64{},
		lifecycleCtx:    lifecycleCtx,
		lifecycleCancel: lifecycleCancel,
		restartDelay:    backoff,
	}
}

func (s *Supervisor) CreateInstance(ctx context.Context, req CreateInstanceRequest) (domain.Instance, error) {
	if err := domain.ValidateID("instance", req.ID); err != nil {
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
	if err := s.writeInstanceConfig(req.ID, config); err != nil {
		return domain.Instance{}, err
	}
	start := req.Start
	status := domain.StatusStopped
	enabled := start
	if svc.RuntimeMode == domain.RuntimeModeOnDemand {
		start = false
		enabled = true
		status = domain.StatusRunning
	}
	inst := domain.Instance{ID: req.ID, ServiceID: req.ServiceID, Name: req.Name, Enabled: enabled, Status: status, NodeEntry: svc.NodeEntry, ConfigJSON: config, ConfigSHA256: domain.ConfigHash(config), SecretJSON: secret, SecretSHA256: domain.HashBytes(secret)}
	if inst.Name == "" {
		inst.Name = req.ID
	}
	if start {
		inst.Status = domain.StatusStarting
	}
	if err := s.Store.UpsertInstance(ctx, inst); err != nil {
		return domain.Instance{}, err
	}
	s.logger().Info("instance_create", "instance_id", inst.ID, "service_id", inst.ServiceID, "runtime_mode", svc.RuntimeMode, "start", req.Start)
	if start {
		if err := s.Start(ctx, req.ID); err != nil {
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
	if restart {
		if err := s.rejectOnDemandRuntimeControl(ctx, inst.ServiceID); err != nil {
			return domain.Instance{}, err
		}
	}
	inst.SecretJSON = secret
	inst.SecretSHA256 = domain.HashBytes(secret)
	if err := s.Store.UpsertInstance(ctx, inst); err != nil {
		return domain.Instance{}, err
	}
	s.logger().Info("instance_secret_updated", "instance_id", instanceID, "secret_sha256", inst.SecretSHA256, "restart", restart)
	if restart {
		if err := s.Restart(ctx, instanceID); err != nil {
			return domain.Instance{}, err
		}
	}
	return s.Store.GetInstance(ctx, instanceID)
}

func (s *Supervisor) UpdateConfig(ctx context.Context, instanceID string, config []byte, restart bool) (domain.Instance, error) {
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
	if restart {
		if err := s.rejectOnDemandRuntimeControl(ctx, inst.ServiceID); err != nil {
			return domain.Instance{}, err
		}
	}
	configPath := filepath.Join(s.InstanceWorkdir(instanceID), "config.json")
	previousConfig, readErr := os.ReadFile(configPath)
	if readErr != nil && !errors.Is(readErr, os.ErrNotExist) {
		return domain.Instance{}, readErr
	}
	if err := s.writeInstanceConfig(instanceID, config); err != nil {
		return domain.Instance{}, err
	}
	inst.ConfigJSON = config
	inst.ConfigSHA256 = domain.ConfigHash(config)
	if err := s.Store.UpsertInstance(ctx, inst); err != nil {
		var restoreErr error
		if readErr == nil {
			restoreErr = s.writeInstanceConfig(instanceID, previousConfig)
		} else {
			restoreErr = os.Remove(configPath)
			if errors.Is(restoreErr, os.ErrNotExist) {
				restoreErr = nil
			}
		}
		if restoreErr != nil {
			return domain.Instance{}, fmt.Errorf("persist config: %w; restore previous config: %v", err, restoreErr)
		}
		return domain.Instance{}, err
	}
	s.logger().Info("instance_config_updated", "instance_id", instanceID, "config_sha256", inst.ConfigSHA256, "restart", restart)
	if restart {
		if err := s.Restart(ctx, instanceID); err != nil {
			return domain.Instance{}, err
		}
	}
	return s.Store.GetInstance(ctx, instanceID)
}

func (s *Supervisor) Start(ctx context.Context, instanceID string) error {
	s.mu.Lock()
	generation := s.nextGenerationLocked(instanceID)
	s.mu.Unlock()
	return s.startWithAttempt(ctx, instanceID, 0, generation)
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
	if svc.RuntimeMode == domain.RuntimeModeOnDemand {
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
	cmd.Env = append(os.Environ(),
		"OCTOBUS_SERVICE_ID="+svc.ID,
		"OCTOBUS_INSTANCE_ID="+instanceID,
		"OCTOBUS_PACKAGE_DIR="+filepath.Join(s.ServiceRuntimeDir(svc.ID), filepath.FromSlash(svc.ServiceRoot)),
		"OCTOBUS_DESCRIPTOR_PATH="+svc.DescriptorPath,
		"OCTOBUS_DESCRIPTOR_SHA256="+svc.DescriptorSHA256,
	)
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
		_ = cmd.Process.Kill()
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
	s.procs[instanceID] = state
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
		_ = state.cmd.Process.Kill()
		_ = state.cmd.Wait()
	}
	close(state.done)
	_ = stdout.Close()
	_ = stderr.Close()
}

func (s *Supervisor) Stop(ctx context.Context, instanceID string) error {
	inst, err := s.Store.GetInstance(ctx, instanceID)
	if err != nil {
		return err
	}
	if err := s.rejectOnDemandRuntimeControl(ctx, inst.ServiceID); err != nil {
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
		if svc.RuntimeMode != domain.RuntimeModeLongRunning {
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
	inst, err := s.Store.GetInstance(ctx, instanceID)
	if err != nil {
		return err
	}
	if err := s.rejectOnDemandRuntimeControl(ctx, inst.ServiceID); err != nil {
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
	return s.Start(ctx, instanceID)
}

func (s *Supervisor) DeleteInstance(ctx context.Context, instanceID string) error {
	inst, err := s.Store.GetInstance(ctx, instanceID)
	if err != nil {
		return err
	}
	svc, err := s.Store.GetService(ctx, inst.ServiceID)
	if err != nil {
		return err
	}
	if svc.RuntimeMode == domain.RuntimeModeOnDemand {
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

func (s *Supervisor) rejectOnDemandRuntimeControl(ctx context.Context, serviceID string) error {
	svc, err := s.Store.GetService(ctx, serviceID)
	if err != nil {
		return err
	}
	if svc.RuntimeMode == domain.RuntimeModeOnDemand {
		return ErrUnsupportedRuntimeControl
	}
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
		_ = state.cmd.Process.Signal(os.Interrupt)
		if err := waitProcessDone(ctx, state.done, 2*time.Second); err != nil {
			_ = state.cmd.Process.Kill()
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
WHERE i.enabled = 1 AND s.runtime_mode = ?
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

func (s *Supervisor) writeInstanceConfig(instanceID string, config []byte) error {
	workdir := s.InstanceWorkdir(instanceID)
	if err := os.MkdirAll(workdir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(workdir, ".config.json-")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(config); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpPath, filepath.Join(workdir, "config.json"))
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
	_ = stdout.Close()
	_ = stderr.Close()
	close(state.done)
	s.mu.Lock()
	current := s.procs[instanceID]
	if current == state {
		delete(s.procs, instanceID)
	}
	s.mu.Unlock()
	ctx := s.lifecycleContext()
	if ctx.Err() != nil {
		return
	}
	inst, getErr := s.Store.GetInstance(ctx, instanceID)
	if getErr != nil || !inst.Enabled || current != state || ctx.Err() != nil {
		return
	}
	s.logger().Warn("instance_exited", "instance_id", instanceID, "pid", processPID(state.cmd), "attempt", state.attempt+1, "error", err)
	if err != nil {
		inst.Status = domain.StatusDegraded
		inst.PID = nil
		_ = s.Store.UpsertInstance(ctx, inst)
		s.notifyInstanceChanged(instanceID)
		s.logger().Warn("instance_degraded", "instance_id", instanceID, "attempt", state.attempt+1)
		s.scheduleRestartAfterBackoff(instanceID, state.attempt+1, state.generation)
		return
	}
	inst.Status = domain.StatusDegraded
	inst.PID = nil
	_ = s.Store.UpsertInstance(ctx, inst)
	s.notifyInstanceChanged(instanceID)
	s.logger().Warn("instance_degraded", "instance_id", instanceID, "attempt", state.attempt+1)
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
	inst, err := s.Store.GetInstance(ctx, instanceID)
	if err != nil || !inst.Enabled {
		return
	}
	if err := s.startWithAttempt(ctx, instanceID, attempt, generation); err != nil {
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
	if svc.RuntimeMode != domain.RuntimeModeLongRunning {
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
