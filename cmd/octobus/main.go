package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"octobus/internal/accesslog"
	"octobus/internal/admin"
	"octobus/internal/cli"
	"octobus/internal/daemonlog"
	"octobus/internal/domain"
	"octobus/internal/hardening"
	"octobus/internal/packageimport"
	"octobus/internal/protocol"
	"octobus/internal/server"
	"octobus/internal/store"
	"octobus/internal/supervisor"

	"github.com/spf13/cobra"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	cmd := newRootCommand(cli.New())
	cmd.SetArgs(args)
	return cmd.Execute()
}

func newRootCommand(adminCLI *cli.CLI) *cobra.Command {
	if adminCLI.AdminAddr == "" {
		adminCLI.AdminAddr = envDefault("OCTOBUS_ADDR", "127.0.0.1:9000")
	}
	return adminCLI.Command(newServeCommand(&adminCLI.AdminAddr))
}

func newServeCommand(addr *string) *cobra.Command {
	var dataDir string
	var dev bool
	var runtimeHardening string
	cmd := &cobra.Command{
		Use:   "serve",
		Short: "Run the Octobus daemon",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			source := "--runtime-hardening"
			if !cmd.Flags().Changed("runtime-hardening") {
				runtimeHardening = os.Getenv("OCTOBUS_RUNTIME_HARDENING")
				source = "OCTOBUS_RUNTIME_HARDENING"
			}
			level, err := hardening.ParseLevel(runtimeHardening)
			if err != nil {
				return fmt.Errorf("%s: %w", source, err)
			}
			return serve(serveOptions{dataDir: dataDir, addr: *addr, dev: dev, runtimeHardening: level})
		},
	}
	cmd.Flags().StringVar(&dataDir, "data-dir", defaultDataDir(), "octobus data directory")
	cmd.Flags().BoolVar(&dev, "dev", false, "seed a fixed development admin token when none exists; requires a loopback listen address (not for production)")
	cmd.Flags().StringVar(&runtimeHardening, "runtime-hardening", string(hardening.LevelOff), "restrictions applied to service runtimes: off, or node for an environment allowlist plus the Node.js permission model (requires Node.js 22.13+, 23.5+, or 24+; env OCTOBUS_RUNTIME_HARDENING)")
	return cmd
}

type serveOptions struct {
	dataDir          string
	addr             string
	dev              bool
	runtimeHardening hardening.Level
	checkNode        func(context.Context) (hardening.Node, error)
	stderr           io.Writer
	logger           *slog.Logger
	startupInventory func(context.Context, *slog.Logger, *store.Store) error
}

const (
	bootstrapAdminTokenID   = "bootstrap-admin"
	bootstrapAdminTokenName = "Bootstrap admin"
	devAdminTokenID         = "dev-admin"
	devAdminTokenName       = "Development admin"
	devAdminTokenSecret     = "octobus-dev-admin-token"
)

type adminAuthOptions struct {
	dev  bool
	addr string
	warn io.Writer
}

func serve(opts serveOptions) error {
	if opts.dev {
		if err := requireDevLoopback(opts.addr); err != nil {
			return err
		}
	}
	stderr := opts.stderr
	if stderr == nil {
		stderr = os.Stderr
	}
	logger := opts.logger
	if logger == nil {
		logger = daemonlog.New(stderr)
	}
	dataDir, err := filepath.Abs(opts.dataDir)
	if err != nil {
		return fmt.Errorf("resolve data dir: %w", err)
	}
	logger.Info("daemon_starting", "addr", opts.addr, "data_dir", dataDir, "runtime_hardening", string(opts.runtimeHardening))
	var runtimeNode hardening.Node
	if opts.runtimeHardening == hardening.LevelNode {
		checkNode := hardening.CheckNode
		if opts.checkNode != nil {
			checkNode = opts.checkNode
		}
		checkCtx, cancel := context.WithTimeout(context.Background(), nodeCheckTimeout)
		runtimeNode, err = checkNode(checkCtx)
		cancel()
		if err != nil {
			return fmt.Errorf("runtime hardening: %w", err)
		}
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return err
	}
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		return err
	}
	defer st.Close()
	if !opts.dev {
		if err := checkLeftoverDevAdminToken(context.Background(), st, opts.addr, stderr); err != nil {
			return err
		}
	}
	accessLogger, err := accesslog.Open(dataDir)
	if err != nil {
		return fmt.Errorf("open access log: %w", err)
	}
	defer accessLogger.Close()
	gateway := &protocol.Gateway{Store: st, DataDir: dataDir, AccessLogger: accessLogger, Logger: logger, RuntimeHardening: opts.runtimeHardening, RuntimeNode: runtimeNode}
	sup := supervisor.New(dataDir, st)
	sup.Logger = logger
	sup.RuntimeHardening = opts.runtimeHardening
	sup.RuntimeNode = runtimeNode
	sup.OnInstanceChanged = gateway.InvalidateInstance
	ctx, stop := signal.NotifyContext(context.Background(), shutdownSignals(opts.runtimeHardening, signal.Ignored(syscall.SIGHUP))...)
	defer stop()
	logger.Info("recover_enabled_started")
	recovered, err := sup.RecoverEnabled(ctx)
	supervisorShutdownNeeded := true
	shutdownSupervisorOnce := func() {
		if !supervisorShutdownNeeded {
			return
		}
		supervisorShutdownNeeded = false
		shutdownSupervisor(logger, sup)
	}
	defer shutdownSupervisorOnce()
	if err != nil {
		logger.Warn("recover_enabled_failed", "error", err)
	}
	logger.Info("recover_enabled_done", "count", recovered)
	startupInventory := logStartupInventory
	if opts.startupInventory != nil {
		startupInventory = opts.startupInventory
	}
	if err := startupInventory(ctx, logger, st); err != nil {
		return err
	}
	if err := initializeAdminAuth(ctx, st, adminAuthOptions{dev: opts.dev, addr: opts.addr, warn: stderr}); err != nil {
		return fmt.Errorf("initialize admin authentication: %w", err)
	}
	adminServer := &admin.Server{Store: st, Importer: &packageimport.Importer{DataDir: dataDir, Store: st}, Supervisor: sup, Gateway: gateway, AccessLogPath: filepath.Join(dataDir, accesslog.FileName), Logger: logger, RequireAdminToken: true}
	grpcServer := protocol.GRPCServer(gateway)
	publicServer := admin.NewHTTPServer(opts.addr, h2c.NewHandler(server.CombinedHandler(adminServer.Handler(), grpcServer, gateway), &http2.Server{}))
	publicListener, err := net.Listen("tcp", opts.addr)
	if err != nil {
		return err
	}
	serverErr := make(chan error, 1)
	go func() {
		if err := publicServer.Serve(publicListener); err != nil && err != http.ErrServerClosed {
			serverErr <- err
			return
		}
		serverErr <- nil
	}()
	logger.Info("daemon_listening", "addr", opts.addr)
	select {
	case err := <-serverErr:
		if err != nil {
			logger.Error("daemon_server_error", "error", err)
			stop()
			logger.Info("daemon_shutdown_started")
			grpcServer.GracefulStop()
			_ = gateway.Close()
			shutdownSupervisorOnce()
			logger.Info("daemon_shutdown_done")
			return err
		}
	case <-ctx.Done():
		logger.Info("daemon_shutdown_started")
		_ = publicServer.Shutdown(context.Background())
		grpcServer.GracefulStop()
		_ = gateway.Close()
		shutdownSupervisorOnce()
		<-serverErr
		logger.Info("daemon_shutdown_done")
	}
	return nil
}

func shutdownSupervisor(logger *slog.Logger, sup *supervisor.Supervisor) {
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := sup.Shutdown(shutdownCtx); err != nil {
		logger.Warn("daemon_supervisor_shutdown_failed", "error", err)
	}
}

func initializeAdminAuth(ctx context.Context, st *store.Store, opts adminAuthOptions) error {
	if opts.dev {
		if err := requireDevLoopback(opts.addr); err != nil {
			return err
		}
	}
	requires, err := st.AdminRequiresToken(ctx)
	if err != nil {
		return err
	}
	if requires {
		return nil
	}
	secret := os.Getenv("OCTOBUS_BOOTSTRAP_ADMIN_TOKEN")
	if secret != "" {
		_, err = st.AddAdminToken(ctx, domain.AdminToken{ID: bootstrapAdminTokenID, Name: bootstrapAdminTokenName}, secret)
		if err != nil {
			return fmt.Errorf("provision bootstrap admin token: %w", err)
		}
		return nil
	}
	if opts.dev {
		_, err = st.AddAdminToken(ctx, domain.AdminToken{ID: devAdminTokenID, Name: devAdminTokenName}, devAdminTokenSecret)
		if err != nil {
			return fmt.Errorf("provision development admin token: %w", err)
		}
		warn := opts.warn
		if warn == nil {
			warn = os.Stderr
		}
		fmt.Fprintf(warn, "warning: --dev seeded a fixed admin token; do not use this mode in production\nexport OCTOBUS_ADMIN_TOKEN=%s\n", devAdminTokenSecret)
		return nil
	}
	return errors.New("admin token authentication is not initialized; set OCTOBUS_BOOTSTRAP_ADMIN_TOKEN or start with --dev")
}

func requireDevLoopback(addr string) error {
	ok, err := listenAddrIsLoopback(addr)
	if err != nil {
		return fmt.Errorf("dev mode: parse listen address %q: %w", addr, err)
	}
	if !ok {
		return fmt.Errorf("dev mode requires a loopback listen address, got %q; use OCTOBUS_BOOTSTRAP_ADMIN_TOKEN instead of --dev", addr)
	}
	return nil
}

func checkLeftoverDevAdminToken(ctx context.Context, st *store.Store, addr string, warn io.Writer) error {
	_, err := st.GetAdminToken(ctx, devAdminTokenID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if warn == nil {
		warn = os.Stderr
	}
	fmt.Fprintf(warn, "warning: data directory has development admin token id=%s; do not use this token in production\n", devAdminTokenID)
	ok, err := listenAddrIsLoopback(addr)
	if err != nil {
		return fmt.Errorf("parse listen address %q: %w", addr, err)
	}
	if !ok {
		return fmt.Errorf("development admin token cannot be used with a non-loopback listen address, got %q; bind loopback or use a fresh data directory with OCTOBUS_BOOTSTRAP_ADMIN_TOKEN", addr)
	}
	return nil
}

func listenAddrIsLoopback(addr string) (bool, error) {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return false, err
	}
	if host == "" {
		return false, nil
	}
	if strings.EqualFold(host, "localhost") {
		return true, nil
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false, nil
	}
	return ip.IsLoopback(), nil
}

func logStartupInventory(ctx context.Context, logger *slog.Logger, st *store.Store) error {
	logger = daemonlog.OrNop(logger)
	capsets, err := st.ListCapsets(ctx)
	if err != nil {
		return fmt.Errorf("list startup capsets: %w", err)
	}
	instances, err := st.ListInstances(ctx)
	if err != nil {
		return fmt.Errorf("list startup instances: %w", err)
	}
	logger.Info("startup_inventory", "capsets", len(capsets), "instances", len(instances))
	for _, capset := range capsets {
		logger.Info("startup_capset", "capset_id", capset.ID, "enabled", capset.Enabled, "name", capset.Name)
	}
	for _, inst := range instances {
		logger.Info("startup_instance", "instance_id", inst.ID, "service_id", inst.ServiceID, "enabled", inst.Enabled, "status", inst.Status, "listen_addr", inst.ListenAddr)
	}
	return nil
}

func defaultDataDir() string {
	if v := os.Getenv("OCTOBUS_DATA_DIR"); v != "" {
		return v
	}
	return ".octobus"
}

// shutdownSignals lists the signals that trigger a graceful shutdown. At level
// node SIGHUP is included too: runtimes run in their own process group there,
// so a terminal hangup reaches only the daemon, and without a graceful
// shutdown they would outlive it. At level off they share the daemon's group
// and exit with it, as before. A daemon started with SIGHUP ignored
// (sighupIgnored), as under nohup, keeps ignoring it, since subscribing would
// undo that.
func shutdownSignals(level hardening.Level, sighupIgnored bool) []os.Signal {
	signals := []os.Signal{os.Interrupt, syscall.SIGTERM}
	if level == hardening.LevelNode && !sighupIgnored {
		signals = append(signals, syscall.SIGHUP)
	}
	return signals
}

// nodeCheckTimeout bounds the startup node checks, the version query and the
// NODE_OPTIONS probe, so a hung node on PATH cannot stall daemon startup.
const nodeCheckTimeout = 10 * time.Second

func envDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
