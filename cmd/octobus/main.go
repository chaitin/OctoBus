package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"octobus/internal/accesslog"
	"octobus/internal/admin"
	"octobus/internal/cli"
	"octobus/internal/daemonlog"
	"octobus/internal/domain"
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
	cmd := &cobra.Command{
		Use:   "serve",
		Short: "Run the Octobus daemon",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			return serve(serveOptions{dataDir: dataDir, addr: *addr})
		},
	}
	cmd.Flags().StringVar(&dataDir, "data-dir", defaultDataDir(), "octobus data directory")
	return cmd
}

type serveOptions struct {
	dataDir          string
	addr             string
	stderr           io.Writer
	logger           *slog.Logger
	startupInventory func(context.Context, *slog.Logger, *store.Store) error
}

func serve(opts serveOptions) error {
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
	logger.Info("daemon_starting", "addr", opts.addr, "data_dir", dataDir)
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return err
	}
	st, err := store.Open(filepath.Join(dataDir, "octobus.db"))
	if err != nil {
		return err
	}
	defer st.Close()
	accessLogger, err := accesslog.Open(dataDir)
	if err != nil {
		return fmt.Errorf("open access log: %w", err)
	}
	defer accessLogger.Close()
	gateway := &protocol.Gateway{Store: st, DataDir: dataDir, AccessLogger: accessLogger, Logger: logger}
	sup := supervisor.New(dataDir, st)
	sup.Logger = logger
	sup.OnInstanceChanged = gateway.InvalidateInstance
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
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
	if err := initializeAdminAuth(ctx, st); err != nil {
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

func initializeAdminAuth(ctx context.Context, st *store.Store) error {
	requires, err := st.AdminRequiresToken(ctx)
	if err != nil {
		return err
	}
	if requires {
		return nil
	}
	secret := os.Getenv("OCTOBUS_BOOTSTRAP_ADMIN_TOKEN")
	if secret == "" {
		return errors.New("admin token authentication is not initialized; set OCTOBUS_BOOTSTRAP_ADMIN_TOKEN before starting the daemon")
	}
	_, err = st.AddAdminToken(ctx, domain.AdminToken{ID: "bootstrap-admin", Name: "Bootstrap admin"}, secret)
	return err
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

func envDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
