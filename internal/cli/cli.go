package cli

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"octobus/internal/domain"
	"octobus/internal/packageimport"
	"octobus/internal/version"

	"github.com/spf13/cobra"
	"go.yaml.in/yaml/v4"
)

type CLI struct {
	AdminAddr string
	Client    *http.Client
	Stdin     io.Reader
	Stdout    io.Writer
	Stderr    io.Writer
}

func New() *CLI {
	addr := os.Getenv("OCTOBUS_ADDR")
	if addr == "" {
		addr = "127.0.0.1:9000"
	}
	return &CLI{AdminAddr: addr, Client: &http.Client{Timeout: 60 * time.Second}, Stdin: os.Stdin, Stdout: os.Stdout, Stderr: os.Stderr}
}

func (c *CLI) Run(args []string) error {
	cmd := c.Command()
	cmd.SetArgs(args)
	return cmd.Execute()
}

func (c *CLI) Command(extraCommands ...*cobra.Command) *cobra.Command {
	cmd := &cobra.Command{
		Use:                   "octobus <commands>",
		Short:                 "Octobus daemon and administration CLI",
		SilenceUsage:          true,
		SilenceErrors:         true,
		DisableFlagsInUseLine: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return cmd.Help()
		},
	}
	setRootUsageTemplate(cmd)
	cmd.SetOut(c.Stdout)
	c.AddAddrFlag(cmd)
	cmd.AddCommand(append(extraCommands, c.Commands()...)...)
	return cmd
}

func (c *CLI) AddAddrFlag(cmd *cobra.Command) {
	cmd.PersistentFlags().StringVar(&c.AdminAddr, "addr", c.AdminAddr, "daemon admin address")
}

func setRootUsageTemplate(cmd *cobra.Command) {
	cmd.SetUsageTemplate(`Usage:
  {{.UseLine}}{{if .HasAvailableSubCommands}}{{$cmds := .Commands}}

Available Commands:{{range $cmds}}{{if (or .IsAvailableCommand (eq .Name "help"))}}
  {{rpad .Name .NamePadding }} {{.Short}}{{end}}{{end}}{{end}}{{if .HasAvailableLocalFlags}}

Flags:
{{.LocalFlags.FlagUsages | trimTrailingWhitespaces}}{{end}}{{if .HasAvailableInheritedFlags}}

Global Flags:
{{.InheritedFlags.FlagUsages | trimTrailingWhitespaces}}{{end}}{{if .HasAvailableSubCommands}}

Use "{{.CommandPath}} COMMAND --help" for more information about a command.{{end}}
`)
}

func (c *CLI) Commands() []*cobra.Command {
	return []*cobra.Command{
		c.statusCommand(),
		c.serviceCommand(),
		c.instanceCommand(),
		c.capsetCommand(),
		c.adminTokenCommand(),
		c.catalogCommand(),
		c.logsCommand(),
		c.versionCommand(),
	}
}

func (c *CLI) versionCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print version information",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			_, err := fmt.Fprint(cmd.OutOrStdout(), version.Current().String())
			return err
		},
	}
}

func (c *CLI) readConfig(configPath, configJSON string, required bool) (json.RawMessage, error) {
	return c.readJSONSource(configPath, configJSON, required, "config", "--config", "--config-json")
}

func (c *CLI) readSecret(secretPath, secretJSON string, required bool) (json.RawMessage, error) {
	return c.readJSONSource(secretPath, secretJSON, required, "secret", "--secret", "--secret-json")
}

func (c *CLI) readTokenSource(tokenValue, tokenFile string, tokenStdin bool) (string, error) {
	sources := 0
	if tokenValue != "" {
		sources++
	}
	if tokenFile != "" {
		sources++
	}
	if tokenStdin {
		sources++
	}
	if sources == 0 {
		return "", errors.New("token source is required; use --token, --token-file, or --token-stdin")
	}
	if sources > 1 {
		return "", errors.New("--token, --token-file, and --token-stdin are mutually exclusive")
	}
	token := tokenValue
	if tokenFile != "" || tokenStdin {
		var raw []byte
		var err error
		if tokenStdin || tokenFile == "-" {
			in := c.Stdin
			if in == nil {
				in = os.Stdin
			}
			raw, err = io.ReadAll(in)
		} else {
			raw, err = os.ReadFile(tokenFile)
		}
		if err != nil {
			return "", err
		}
		token = strings.TrimSpace(string(raw))
	}
	if strings.TrimSpace(token) == "" {
		return "", errors.New("token source is empty")
	}
	return token, nil
}

func (c *CLI) readJSONSource(pathValue, jsonValue string, required bool, name, pathFlag, jsonFlag string) (json.RawMessage, error) {
	if pathValue != "" && jsonValue != "" {
		return nil, fmt.Errorf("%s and %s are mutually exclusive", pathFlag, jsonFlag)
	}
	if jsonValue != "" {
		if !json.Valid([]byte(jsonValue)) {
			return nil, fmt.Errorf("invalid %s: value must be valid JSON", jsonFlag)
		}
		return json.RawMessage(jsonValue), nil
	}
	if pathValue != "" {
		var raw []byte
		var err error
		if pathValue == "-" {
			in := c.Stdin
			if in == nil {
				in = os.Stdin
			}
			raw, err = io.ReadAll(in)
		} else {
			raw, err = os.ReadFile(pathValue)
		}
		if err != nil {
			return nil, err
		}
		if !json.Valid(raw) {
			return nil, fmt.Errorf("invalid %s: value must be valid JSON", pathFlag)
		}
		return json.RawMessage(raw), nil
	}
	if required {
		return nil, fmt.Errorf("%s source is required; use %s or %s", name, pathFlag, jsonFlag)
	}
	return json.RawMessage(`{}`), nil
}

func (c *CLI) statusCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show daemon status",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			return c.request(http.MethodGet, "/admin/v1/status", nil)
		},
	}
}

func (c *CLI) serviceCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "service",
		Short: "Manage service packages",
		RunE: func(cmd *cobra.Command, args []string) error {
			return errors.New("usage: octobus service <import|list|get|update|delete>")
		},
	}
	cmd.AddCommand(c.serviceImportCommand(), c.listCommand("service", "/admin/v1/services"), c.getCommand("service", "/admin/v1/services/"), c.serviceUpdateCommand(), c.deleteCommand("service", "/admin/v1/services/"))
	return cmd
}

func (c *CLI) serviceImportCommand() *cobra.Command {
	var name, build, sourceModeValue string
	var offline, reinstall, recursive bool
	cmd := &cobra.Command{
		Use:   "import SERVICE SOURCE [--name NAME] [--build auto|always|never] [--offline] [--reinstall]\n  octobus service import --recursive SOURCE [--build auto|always|never] [--offline] [--reinstall]",
		Short: "Import or update a service package",
		Args: func(cmd *cobra.Command, args []string) error {
			if recursive {
				if name != "" {
					return errors.New("--name cannot be used with --recursive")
				}
				if len(args) < 1 {
					return errors.New("service source is required")
				}
				if len(args) > 1 {
					return fmt.Errorf("accepts 1 arg(s), received %d", len(args))
				}
				return nil
			}
			if len(args) < 1 {
				return errors.New("service id is required")
			}
			if len(args) < 2 {
				return errors.New("service source is required")
			}
			if len(args) > 2 {
				return fmt.Errorf("accepts 2 arg(s), received %d", len(args))
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			var sourceArg string
			if recursive {
				sourceArg = args[0]
			} else {
				sourceArg = args[1]
			}
			transfer, err := resolveImportSourceTransfer(sourceArg, sourceModeValue)
			if err != nil {
				return err
			}
			source := transfer.Source
			if recursive {
				body := map[string]any{"recursive": true, "source": source, "offline": offline, "reinstall": reinstall, "build": build}
				if transfer.Upload {
					return c.requestServiceImportUpload(body, transfer.Local)
				}
				return c.requestServiceImport(body)
			}
			body := map[string]any{"service_id": args[0], "name": name, "source": source, "offline": offline, "reinstall": reinstall, "build": build}
			if transfer.Upload {
				return c.requestServiceImportUpload(body, transfer.Local)
			}
			return c.requestServiceImport(body)
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "service display name override")
	cmd.Flags().StringVar(&build, "build", "auto", "source package build policy: auto, always, or never")
	cmd.Flags().StringVar(&sourceModeValue, "source-mode", "auto", "source transfer mode: auto, upload, or remote")
	cmd.Flags().BoolVar(&offline, "offline", false, "use npm offline cache")
	cmd.Flags().BoolVar(&reinstall, "reinstall", false, "reinstall dependencies")
	cmd.Flags().BoolVar(&recursive, "recursive", false, "import all services discovered under the package source")
	return cmd
}

func (c *CLI) serviceUpdateCommand() *cobra.Command {
	var name string
	cmd := &cobra.Command{
		Use:   "update SERVICE --name NAME",
		Short: "Update service metadata",
		Args: func(cmd *cobra.Command, args []string) error {
			if len(args) < 1 {
				return errors.New("service id is required")
			}
			if len(args) > 1 {
				return fmt.Errorf("accepts 1 arg(s), received %d", len(args))
			}
			return nil
		},
		PreRunE: func(cmd *cobra.Command, args []string) error {
			if name == "" {
				return errors.New("service name is required")
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			return c.request(http.MethodPatch, "/admin/v1/services/"+args[0], map[string]any{"name": name})
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "service name")
	return cmd
}

func normalizeImportSource(source string) (string, error) {
	if strings.HasPrefix(source, "npm:") {
		spec := strings.TrimPrefix(source, "npm:")
		normalized, err := normalizeLocalImportPackageSource(spec)
		if err != nil {
			return "", err
		}
		if normalized == spec {
			return source, nil
		}
		return "npm:" + normalized, nil
	}
	return normalizeLocalImportPackageSource(source)
}

func normalizeLocalImportPackageSource(source string) (string, error) {
	if source == "" || strings.Contains(source, "://") {
		return source, nil
	}
	packageSource, serviceRoot, ok := strings.Cut(source, "//")
	normalized, err := normalizeLocalImportSource(packageSource)
	if err != nil {
		return "", err
	}
	if !ok {
		return normalized, nil
	}
	return normalized + "//" + serviceRoot, nil
}

func normalizeLocalImportSource(source string) (string, error) {
	if source == "" || strings.Contains(source, "://") || filepath.IsAbs(source) {
		return source, nil
	}
	if _, err := os.Stat(source); err != nil {
		return source, nil
	}
	abs, err := filepath.Abs(source)
	if err != nil {
		return "", fmt.Errorf("resolve import source %q: %w", source, err)
	}
	return abs, nil
}

type sourceTransferMode string

const (
	sourceTransferAuto   sourceTransferMode = "auto"
	sourceTransferUpload sourceTransferMode = "upload"
	sourceTransferRemote sourceTransferMode = "remote"
)

type importSourceTransfer struct {
	Source string
	Upload bool
	Local  localImportSource
}

type localImportSource struct {
	Path       string
	Source     string
	UploadKind packageimport.UploadKind
}

func resolveImportSourceTransfer(source, modeValue string) (importSourceTransfer, error) {
	mode, err := parseSourceTransferMode(modeValue)
	if err != nil {
		return importSourceTransfer{}, err
	}
	if mode == sourceTransferRemote {
		normalized, err := normalizeImportSource(source)
		if err != nil {
			return importSourceTransfer{}, err
		}
		return importSourceTransfer{Source: normalized}, nil
	}
	local, ok, err := classifyLocalImportSource(source)
	if err != nil {
		return importSourceTransfer{}, err
	}
	if ok {
		return importSourceTransfer{Source: local.Source, Upload: true, Local: local}, nil
	}
	if mode == sourceTransferUpload {
		return importSourceTransfer{}, fmt.Errorf("--source-mode upload requires an existing local directory, .tgz/.tar.gz/.zip archive, or npm: local path source")
	}
	normalized, err := normalizeImportSource(source)
	if err != nil {
		return importSourceTransfer{}, err
	}
	return importSourceTransfer{Source: normalized}, nil
}

func parseSourceTransferMode(value string) (sourceTransferMode, error) {
	switch mode := sourceTransferMode(value); mode {
	case sourceTransferAuto, sourceTransferUpload, sourceTransferRemote:
		return mode, nil
	default:
		return "", fmt.Errorf("invalid source mode %q: expected auto, upload, or remote", value)
	}
}

func classifyLocalImportSource(raw string) (localImportSource, bool, error) {
	npmLocal := false
	source := raw
	if strings.HasPrefix(source, "npm:") {
		npmLocal = true
		source = strings.TrimPrefix(source, "npm:")
	}
	if source == "" || strings.Contains(source, "://") {
		return localImportSource{}, false, nil
	}
	packageSource, serviceRoot, hasServiceRoot := strings.Cut(source, "//")
	if packageSource == "" {
		return localImportSource{}, false, nil
	}
	info, err := os.Stat(packageSource)
	if err != nil {
		if os.IsNotExist(err) {
			return localImportSource{}, false, nil
		}
		return localImportSource{}, false, fmt.Errorf("stat import source %q: %w", packageSource, err)
	}
	abs, err := filepath.Abs(packageSource)
	if err != nil {
		return localImportSource{}, false, fmt.Errorf("resolve import source %q: %w", packageSource, err)
	}
	var kind packageimport.UploadKind
	if info.IsDir() {
		kind = packageimport.UploadKindDirectory
	} else if info.Mode().IsRegular() && supportedImportArchive(packageSource) {
		kind = packageimport.UploadKindArchive
	} else {
		return localImportSource{}, false, nil
	}
	if npmLocal {
		kind = packageimport.UploadKindNPMLocal
	}
	display := filepath.Base(filepath.Clean(abs))
	sanitized := "client-upload:" + display
	if hasServiceRoot {
		sanitized += "//" + serviceRoot
	}
	return localImportSource{Path: abs, Source: sanitized, UploadKind: kind}, true, nil
}

func supportedImportArchive(path string) bool {
	lower := strings.ToLower(path)
	return strings.HasSuffix(lower, ".tgz") || strings.HasSuffix(lower, ".tar.gz") || strings.HasSuffix(lower, ".zip")
}

func (c *CLI) instanceCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "instance",
		Short: "Manage service instances",
		RunE: func(cmd *cobra.Command, args []string) error {
			return errors.New("usage: octobus instance <create|list|get|update|delete|update-config|update-secret|start|stop|restart>")
		},
	}
	cmd.AddCommand(c.instanceCreateCommand(), c.listCommand("instance", "/admin/v1/instances"), c.getCommand("instance", "/admin/v1/instances/"), c.instanceUpdateCommand(), c.deleteCommand("instance", "/admin/v1/instances/"), c.instanceUpdateConfigCommand(), c.instanceUpdateSecretCommand(), c.instanceActionCommand("start"), c.instanceActionCommand("stop"), c.instanceActionCommand("restart"))
	return cmd
}

func (c *CLI) instanceCreateCommand() *cobra.Command {
	var serviceID, name, configPath, configJSON, secretPath, secretJSON string
	var noStart bool
	cmd := &cobra.Command{
		Use:   "create INSTANCE --service SERVICE [--name NAME] [--config CONFIG | --config-json JSON] [--secret SECRET | --secret-json JSON] [--no-start]",
		Short: "Create an instance",
		Args: func(cmd *cobra.Command, args []string) error {
			if len(args) < 1 {
				return errors.New("instance id is required")
			}
			if len(args) > 1 {
				return fmt.Errorf("accepts 1 arg(s), received %d", len(args))
			}
			return nil
		},
		PreRunE: func(cmd *cobra.Command, args []string) error {
			if serviceID == "" {
				return errors.New("service id is required")
			}
			if configPath == "-" && secretPath == "-" {
				return errors.New("instance create cannot read both --config - and --secret - from stdin")
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			config, err := c.readConfig(configPath, configJSON, false)
			if err != nil {
				return err
			}
			secret, err := c.readSecret(secretPath, secretJSON, false)
			if err != nil {
				return err
			}
			return c.request(http.MethodPost, "/admin/v1/instances", map[string]any{"id": args[0], "service_id": serviceID, "name": name, "config": config, "secret": secret, "start": !noStart})
		},
	}
	cmd.Flags().StringVar(&serviceID, "service", "", "service id")
	cmd.Flags().StringVar(&name, "name", "", "instance name")
	cmd.Flags().StringVar(&configPath, "config", "", "config JSON path")
	cmd.Flags().StringVar(&configJSON, "config-json", "", "config JSON string")
	cmd.Flags().StringVar(&secretPath, "secret", "", "secret JSON path")
	cmd.Flags().StringVar(&secretJSON, "secret-json", "", "secret JSON string")
	cmd.Flags().BoolVar(&noStart, "no-start", false, "do not start instance after create")
	return cmd
}

func (c *CLI) instanceUpdateCommand() *cobra.Command {
	var name string
	cmd := &cobra.Command{
		Use:   "update INSTANCE --name NAME",
		Short: "Update instance metadata",
		Args: func(cmd *cobra.Command, args []string) error {
			if len(args) < 1 {
				return errors.New("instance id is required")
			}
			if len(args) > 1 {
				return fmt.Errorf("accepts 1 arg(s), received %d", len(args))
			}
			return nil
		},
		PreRunE: func(cmd *cobra.Command, args []string) error {
			if name == "" {
				return errors.New("instance name is required")
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			return c.request(http.MethodPatch, "/admin/v1/instances/"+args[0], map[string]any{"name": name})
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "instance name")
	return cmd
}

func (c *CLI) instanceUpdateConfigCommand() *cobra.Command {
	var configPath, configJSON string
	var restart bool
	cmd := &cobra.Command{
		Use:   "update-config INSTANCE (--config CONFIG | --config-json JSON) [--restart]",
		Short: "Update an instance config",
		Args: func(cmd *cobra.Command, args []string) error {
			if len(args) < 1 {
				return errors.New("instance id is required")
			}
			if len(args) > 1 {
				return fmt.Errorf("accepts 1 arg(s), received %d", len(args))
			}
			return nil
		},
		PreRunE: func(cmd *cobra.Command, args []string) error {
			if configPath == "" && configJSON == "" {
				return errors.New("instance update-config requires --config or --config-json")
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			config, err := c.readConfig(configPath, configJSON, true)
			if err != nil {
				return err
			}
			return c.request(http.MethodPost, "/admin/v1/instances/"+args[0]+"/config", map[string]any{"config": config, "restart": restart})
		},
	}
	cmd.Flags().StringVar(&configPath, "config", "", "config JSON path")
	cmd.Flags().StringVar(&configJSON, "config-json", "", "config JSON string")
	cmd.Flags().BoolVar(&restart, "restart", false, "restart after update")
	return cmd
}

func (c *CLI) instanceUpdateSecretCommand() *cobra.Command {
	var secretPath, secretJSON string
	var restart bool
	cmd := &cobra.Command{
		Use:   "update-secret INSTANCE (--secret SECRET | --secret-json JSON) [--restart]",
		Short: "Update an instance secret",
		Args: func(cmd *cobra.Command, args []string) error {
			if len(args) < 1 {
				return errors.New("instance id is required")
			}
			if len(args) > 1 {
				return fmt.Errorf("accepts 1 arg(s), received %d", len(args))
			}
			return nil
		},
		PreRunE: func(cmd *cobra.Command, args []string) error {
			if secretPath == "" && secretJSON == "" {
				return errors.New("instance update-secret requires --secret or --secret-json")
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			secret, err := c.readSecret(secretPath, secretJSON, true)
			if err != nil {
				return err
			}
			return c.request(http.MethodPost, "/admin/v1/instances/"+args[0]+"/secret", map[string]any{"secret": secret, "restart": restart})
		},
	}
	cmd.Flags().StringVar(&secretPath, "secret", "", "secret JSON path")
	cmd.Flags().StringVar(&secretJSON, "secret-json", "", "secret JSON string")
	cmd.Flags().BoolVar(&restart, "restart", false, "restart after update")
	return cmd
}

func (c *CLI) instanceActionCommand(action string) *cobra.Command {
	cmd := &cobra.Command{
		Use:   action + " INSTANCE",
		Short: strings.Title(action) + " an instance",
		Args: func(cmd *cobra.Command, args []string) error {
			if len(args) < 1 {
				return errors.New("instance id is required")
			}
			if len(args) > 1 {
				return fmt.Errorf("accepts 1 arg(s), received %d", len(args))
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			return c.request(http.MethodPost, "/admin/v1/instances/"+args[0]+"/"+action, map[string]any{})
		},
	}
	return cmd
}

func (c *CLI) capsetCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "capset",
		Short: "Manage capability sets",
		RunE: func(cmd *cobra.Command, args []string) error {
			return errors.New("usage: octobus capset <create|list|get|update|delete|add-instance|remove-instance|list-instances|select-method|unselect-method|list-methods|add-token|list-tokens|remove-token>")
		},
	}
	cmd.AddCommand(c.capsetCreateCommand(), c.listCommand("capset", "/admin/v1/capsets"), c.getCommand("capset", "/admin/v1/capsets/"), c.capsetUpdateCommand(), c.deleteCommand("capset", "/admin/v1/capsets/"), c.capsetAddInstanceCommand(), c.capsetRemoveInstanceCommand(), c.capsetListInstancesCommand(), c.capsetSelectMethodCommand(), c.capsetUnselectMethodCommand(), c.capsetListMethodsCommand(), c.capsetAddTokenCommand(), c.capsetListTokensCommand(), c.capsetRemoveTokenCommand())
	return cmd
}

func (c *CLI) capsetCreateCommand() *cobra.Command {
	var name, desc string
	cmd := &cobra.Command{
		Use:   "create CAPSET [--name NAME] [--description DESCRIPTION]",
		Short: "Create a capset",
		Args: func(cmd *cobra.Command, args []string) error {
			if len(args) < 1 {
				return errors.New("capset id is required")
			}
			if len(args) > 1 {
				return fmt.Errorf("accepts 1 arg(s), received %d", len(args))
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			capsetName := name
			if capsetName == "" {
				capsetName = args[0]
			}
			return c.request(http.MethodPost, "/admin/v1/capsets", map[string]any{"id": args[0], "name": capsetName, "description": desc, "enabled": true})
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "capset name")
	cmd.Flags().StringVar(&desc, "description", "", "description")
	return cmd
}

func (c *CLI) capsetUpdateCommand() *cobra.Command {
	var name, desc string
	var enabled bool
	var nameSet, descSet, enabledSet bool
	cmd := &cobra.Command{
		Use:   "update CAPSET [--name NAME] [--description DESCRIPTION] [--enabled=true|false]",
		Short: "Update a capset",
		Args: func(cmd *cobra.Command, args []string) error {
			if len(args) < 1 {
				return errors.New("capset id is required")
			}
			if len(args) > 1 {
				return fmt.Errorf("accepts 1 arg(s), received %d", len(args))
			}
			return nil
		},
		PreRunE: func(cmd *cobra.Command, args []string) error {
			nameSet = cmd.Flags().Changed("name")
			descSet = cmd.Flags().Changed("description")
			enabledSet = cmd.Flags().Changed("enabled")
			if !nameSet && !descSet && !enabledSet {
				return errors.New("capset update requires at least one field")
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			body := map[string]any{}
			if nameSet {
				body["name"] = name
			}
			if descSet {
				body["description"] = desc
			}
			if enabledSet {
				body["enabled"] = enabled
			}
			return c.request(http.MethodPatch, "/admin/v1/capsets/"+args[0], body)
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "capset name")
	cmd.Flags().StringVar(&desc, "description", "", "description")
	cmd.Flags().BoolVar(&enabled, "enabled", true, "whether capset is enabled")
	return cmd
}

func (c *CLI) capsetAddInstanceCommand() *cobra.Command {
	var noAllMethods bool
	cmd := &cobra.Command{
		Use:   "add-instance CAPSET INSTANCE [--no-all-methods]",
		Short: "Add an instance to a capset",
		Args: func(cmd *cobra.Command, args []string) error {
			if len(args) < 1 {
				return errors.New("capset id is required")
			}
			if len(args) < 2 {
				return errors.New("instance id is required")
			}
			if len(args) > 2 {
				return fmt.Errorf("accepts 2 arg(s), received %d", len(args))
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			return c.request(http.MethodPost, "/admin/v1/capsets/"+args[0]+"/instances", map[string]any{"instance_id": args[1], "all_methods": !noAllMethods, "no_all_methods": noAllMethods})
		},
	}
	cmd.Flags().BoolVar(&noAllMethods, "no-all-methods", false, "do not select all methods")
	return cmd
}

func (c *CLI) capsetRemoveInstanceCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "remove-instance CAPSET INSTANCE",
		Short: "Remove an instance from a capset",
		Args: func(cmd *cobra.Command, args []string) error {
			if len(args) < 1 {
				return errors.New("capset id is required")
			}
			if len(args) < 2 {
				return errors.New("instance id is required")
			}
			if len(args) > 2 {
				return fmt.Errorf("accepts 2 arg(s), received %d", len(args))
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			return c.request(http.MethodDelete, "/admin/v1/capsets/"+args[0]+"/instances/"+args[1], nil)
		},
	}
	return cmd
}

func (c *CLI) capsetListInstancesCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "list-instances CAPSET",
		Short: "List capset instances",
		Args: func(cmd *cobra.Command, args []string) error {
			if len(args) < 1 {
				return errors.New("capset id is required")
			}
			if len(args) > 1 {
				return fmt.Errorf("accepts 1 arg(s), received %d", len(args))
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			return c.request(http.MethodGet, "/admin/v1/capsets/"+args[0]+"/instances", nil)
		},
	}
	return cmd
}

func (c *CLI) capsetSelectMethodCommand() *cobra.Command {
	var mcpTool string
	cmd := &cobra.Command{
		Use:   "select-method CAPSET INSTANCE METHOD [--mcp-tool TOOL]",
		Short: "Select a method for a capset instance",
		Args: func(cmd *cobra.Command, args []string) error {
			if len(args) < 1 {
				return errors.New("capset id is required")
			}
			if len(args) < 2 {
				return errors.New("instance id is required")
			}
			if len(args) < 3 {
				return errors.New("method is required")
			}
			if len(args) > 3 {
				return fmt.Errorf("accepts 3 arg(s), received %d", len(args))
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			return c.request(http.MethodPost, "/admin/v1/capsets/"+args[0]+"/methods", map[string]any{"instance_id": args[1], "method": args[2], "mcp_tool": mcpTool})
		},
	}
	cmd.Flags().StringVar(&mcpTool, "mcp-tool", "", "MCP tool name")
	return cmd
}

func (c *CLI) capsetUnselectMethodCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "unselect-method CAPSET INSTANCE METHOD",
		Short: "Remove a selected capset method",
		Args: func(cmd *cobra.Command, args []string) error {
			if len(args) < 1 {
				return errors.New("capset id is required")
			}
			if len(args) < 2 {
				return errors.New("instance id is required")
			}
			if len(args) < 3 {
				return errors.New("method is required")
			}
			if len(args) > 3 {
				return fmt.Errorf("accepts 3 arg(s), received %d", len(args))
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			return c.request(http.MethodDelete, "/admin/v1/capsets/"+args[0]+"/methods?instance_id="+url.QueryEscape(args[1])+"&method="+url.QueryEscape(args[2]), nil)
		},
	}
	return cmd
}

func (c *CLI) capsetListMethodsCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "list-methods CAPSET",
		Short: "List selected capset methods",
		Args: func(cmd *cobra.Command, args []string) error {
			if len(args) < 1 {
				return errors.New("capset id is required")
			}
			if len(args) > 1 {
				return fmt.Errorf("accepts 1 arg(s), received %d", len(args))
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			return c.request(http.MethodGet, "/admin/v1/capsets/"+args[0]+"/methods", nil)
		},
	}
	return cmd
}

func (c *CLI) capsetAddTokenCommand() *cobra.Command {
	var name, token, tokenFile string
	var tokenStdin bool
	cmd := &cobra.Command{
		Use:   "add-token CAPSET TOKEN_ID [--name NAME] (--token TOKEN | --token-file PATH | --token-stdin)",
		Short: "Add an access token to a capset",
		Args: func(cmd *cobra.Command, args []string) error {
			if len(args) < 1 {
				return errors.New("capset id is required")
			}
			if len(args) < 2 {
				return errors.New("token id is required")
			}
			if len(args) > 2 {
				return fmt.Errorf("accepts 2 arg(s), received %d", len(args))
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			secret, err := c.readTokenSource(token, tokenFile, tokenStdin)
			if err != nil {
				return err
			}
			return c.request(http.MethodPost, "/admin/v1/capsets/"+args[0]+"/tokens", map[string]any{"id": args[1], "name": name, "token": secret})
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "token display name")
	cmd.Flags().StringVar(&token, "token", "", "access token secret")
	cmd.Flags().StringVar(&tokenFile, "token-file", "", "access token file path")
	cmd.Flags().BoolVar(&tokenStdin, "token-stdin", false, "read access token from stdin")
	return cmd
}

func (c *CLI) capsetListTokensCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "list-tokens CAPSET",
		Short: "List capset access tokens",
		Args: func(cmd *cobra.Command, args []string) error {
			if len(args) < 1 {
				return errors.New("capset id is required")
			}
			if len(args) > 1 {
				return fmt.Errorf("accepts 1 arg(s), received %d", len(args))
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			return c.request(http.MethodGet, "/admin/v1/capsets/"+args[0]+"/tokens", nil)
		},
	}
	return cmd
}

func (c *CLI) capsetRemoveTokenCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "remove-token CAPSET TOKEN_ID",
		Short: "Remove a capset access token",
		Args: func(cmd *cobra.Command, args []string) error {
			if len(args) < 1 {
				return errors.New("capset id is required")
			}
			if len(args) < 2 {
				return errors.New("token id is required")
			}
			if len(args) > 2 {
				return fmt.Errorf("accepts 2 arg(s), received %d", len(args))
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			return c.request(http.MethodDelete, "/admin/v1/capsets/"+args[0]+"/tokens/"+args[1], nil)
		},
	}
	return cmd
}

func (c *CLI) adminTokenCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "admin-token",
		Short: "Manage admin access tokens",
		RunE: func(cmd *cobra.Command, args []string) error {
			return errors.New("usage: octobus admin-token <add|list|get|delete|remove>")
		},
	}
	cmd.AddCommand(c.adminTokenAddCommand(), c.listCommand("admin token", "/admin/v1/tokens"), c.getCommand("admin token", "/admin/v1/tokens/"), c.deleteCommand("admin token", "/admin/v1/tokens/"), c.adminTokenRemoveCommand())
	return cmd
}

func (c *CLI) adminTokenAddCommand() *cobra.Command {
	var name, token, tokenFile string
	var tokenStdin bool
	cmd := &cobra.Command{
		Use:   "add TOKEN_ID [--name NAME] (--token TOKEN | --token-file PATH | --token-stdin)",
		Short: "Add an admin access token",
		Args: func(cmd *cobra.Command, args []string) error {
			if len(args) < 1 {
				return errors.New("token id is required")
			}
			if len(args) > 1 {
				return fmt.Errorf("accepts 1 arg(s), received %d", len(args))
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			secret, err := c.readTokenSource(token, tokenFile, tokenStdin)
			if err != nil {
				return err
			}
			return c.request(http.MethodPost, "/admin/v1/tokens", map[string]any{"id": args[0], "name": name, "token": secret})
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "token display name")
	cmd.Flags().StringVar(&token, "token", "", "access token secret")
	cmd.Flags().StringVar(&tokenFile, "token-file", "", "access token file path")
	cmd.Flags().BoolVar(&tokenStdin, "token-stdin", false, "read access token from stdin")
	return cmd
}

func (c *CLI) adminTokenRemoveCommand() *cobra.Command {
	cmd := c.deleteCommand("admin token", "/admin/v1/tokens/")
	cmd.Use = "remove TOKEN_ID"
	cmd.Aliases = nil
	return cmd
}

func (c *CLI) catalogCommand() *cobra.Command {
	var grpcFlag, mcpFlag, connectFlag, allFlag bool
	var jsonFlag, mdFlag, openAPIJSON, openAPIYAML bool
	cmd := &cobra.Command{
		Use:   "catalog CAPSET [--grpc|--mcp|--connect|--all] [--json|--md|--openapi-json|--openapi-yaml]",
		Short: "Show a capset protocol catalog",
		Args: func(cmd *cobra.Command, args []string) error {
			if len(args) < 1 {
				return errors.New("capset id is required")
			}
			if len(args) > 1 {
				return fmt.Errorf("accepts 1 arg(s), received %d", len(args))
			}
			return nil
		},
		PreRunE: func(cmd *cobra.Command, args []string) error {
			specific := boolCount(grpcFlag, mcpFlag, connectFlag)
			if allFlag && specific > 0 {
				return errors.New("--all is mutually exclusive with --grpc, --mcp, and --connect")
			}
			if boolCount(jsonFlag, mdFlag, openAPIJSON, openAPIYAML) > 1 {
				return errors.New("--json, --md, --openapi-json, and --openapi-yaml are mutually exclusive")
			}
			if (openAPIJSON || openAPIYAML) && (allFlag || specific > 0) {
				return errors.New("OpenAPI output flags conflict with protocol selector flags")
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			capsetID := args[0]
			if openAPIJSON {
				return c.requestRaw(http.MethodGet, "/admin/v1/catalog/"+url.PathEscape(capsetID)+"/openapi.json", nil)
			}
			if openAPIYAML {
				return c.requestRaw(http.MethodGet, "/admin/v1/catalog/"+url.PathEscape(capsetID)+"/openapi.yaml", nil)
			}
			q := url.Values{}
			if allFlag {
				q.Set("all", "true")
			} else {
				if grpcFlag {
					q.Set("grpc", "true")
				}
				if mcpFlag {
					q.Set("mcp", "true")
				}
				if connectFlag {
					q.Set("connect", "true")
				}
				if !grpcFlag && !mcpFlag && !connectFlag {
					q.Set("grpc", "true")
				}
			}
			if mdFlag {
				q.Set("format", "md")
				return c.requestRaw(http.MethodGet, "/admin/v1/catalog/"+url.PathEscape(capsetID)+"?"+q.Encode(), nil)
			}
			q.Set("format", "json")
			return c.request(http.MethodGet, "/admin/v1/catalog/"+url.PathEscape(capsetID)+"?"+q.Encode(), nil)
		},
	}
	cmd.Flags().BoolVar(&grpcFlag, "grpc", false, "include gRPC catalog")
	cmd.Flags().BoolVar(&mcpFlag, "mcp", false, "include MCP catalog")
	cmd.Flags().BoolVar(&connectFlag, "connect", false, "include Connect RPC catalog")
	cmd.Flags().BoolVar(&allFlag, "all", false, "include all catalog protocols")
	cmd.Flags().BoolVar(&jsonFlag, "json", false, "output catalog JSON")
	cmd.Flags().BoolVar(&mdFlag, "md", false, "output catalog Markdown")
	cmd.Flags().BoolVar(&openAPIJSON, "openapi-json", false, "output Connect RPC OpenAPI JSON")
	cmd.Flags().BoolVar(&openAPIYAML, "openapi-yaml", false, "output Connect RPC OpenAPI YAML")
	return cmd
}

func (c *CLI) logsCommand() *cobra.Command {
	var capsetID, instanceID, serviceID string
	var limit, tail int
	var follow bool
	cmd := &cobra.Command{
		Use:   "logs [--capset ID] [--instance ID] [--service ID] [--limit N] [--tail N] [-f]",
		Short: "Show access logs",
		Args:  cobra.NoArgs,
		PreRunE: func(cmd *cobra.Command, args []string) error {
			if limit < 0 {
				return errors.New("limit must be non-negative")
			}
			if tail < 0 {
				return errors.New("tail must be non-negative")
			}
			if cmd.Flags().Changed("limit") && cmd.Flags().Changed("tail") {
				return errors.New("limit and tail are mutually exclusive")
			}
			if follow && cmd.Flags().Changed("limit") {
				return errors.New("limit and follow are mutually exclusive")
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			q := url.Values{}
			if capsetID != "" {
				q.Set("capset", capsetID)
			}
			if instanceID != "" {
				q.Set("instance", instanceID)
			}
			if serviceID != "" {
				q.Set("service", serviceID)
			}
			if cmd.Flags().Changed("limit") {
				q.Set("limit", fmt.Sprintf("%d", limit))
			}
			if cmd.Flags().Changed("tail") {
				q.Set("tail", fmt.Sprintf("%d", tail))
			}
			if follow {
				q.Set("follow", "true")
			}
			path := "/admin/v1/logs/access"
			if encoded := q.Encode(); encoded != "" {
				path += "?" + encoded
			}
			if follow {
				return c.requestStream(http.MethodGet, path, nil)
			}
			return c.requestRaw(http.MethodGet, path, nil)
		},
	}
	cmd.Flags().StringVar(&capsetID, "capset", "", "filter by capset id")
	cmd.Flags().StringVar(&instanceID, "instance", "", "filter by instance id")
	cmd.Flags().StringVar(&serviceID, "service", "", "filter by service id")
	cmd.Flags().IntVar(&limit, "limit", 200, "maximum records to return; 0 returns all")
	cmd.Flags().IntVar(&tail, "tail", 200, "show the last N matching records; 0 skips existing records")
	cmd.Flags().BoolVarP(&follow, "follow", "f", false, "stream new matching records")
	return cmd
}

func boolCount(values ...bool) int {
	var count int
	for _, value := range values {
		if value {
			count++
		}
	}
	return count
}

func (c *CLI) listCommand(kind, path string) *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List " + kind + " records",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			return c.request(http.MethodGet, path, nil)
		},
	}
}

func (c *CLI) getCommand(kind, pathPrefix string) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "get ID",
		Short: "Get " + article(kind) + kind + " record",
		Args: func(cmd *cobra.Command, args []string) error {
			if len(args) < 1 {
				return errors.New(idTerm(kind) + " is required")
			}
			if len(args) > 1 {
				return fmt.Errorf("accepts 1 arg(s), received %d", len(args))
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			return c.request(http.MethodGet, pathPrefix+args[0], nil)
		},
	}
	return cmd
}

func (c *CLI) deleteCommand(kind, pathPrefix string) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "delete ID",
		Short: "Delete " + article(kind) + kind + " record",
		Args: func(cmd *cobra.Command, args []string) error {
			if len(args) < 1 {
				return errors.New(idTerm(kind) + " is required")
			}
			if len(args) > 1 {
				return fmt.Errorf("accepts 1 arg(s), received %d", len(args))
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			return c.request(http.MethodDelete, pathPrefix+args[0], nil)
		},
	}
	return cmd
}

func article(kind string) string {
	switch kind {
	case "admin token":
		return "an "
	default:
		return "a "
	}
}

func idTerm(kind string) string {
	switch kind {
	case "admin token":
		return "token id"
	default:
		return kind + " id"
	}
}

func (c *CLI) request(method, path string, body any) error {
	return c.requestAndPrint(method, path, body, true)
}

func (c *CLI) requestRaw(method, path string, body any) error {
	return c.requestAndPrint(method, path, body, false)
}

func (c *CLI) requestServiceImport(body any) error {
	client := *c.Client
	client.Timeout = 0
	return c.doRequestWithClientAndHeaders(&client, http.MethodPost, "/admin/v1/services/import", body, map[string]string{"Accept": "application/x-ndjson"}, c.handleServiceImportStream)
}

func (c *CLI) requestServiceImportUpload(body any, source localImportSource) error {
	client := *c.Client
	client.Timeout = 0
	pr, pw := io.Pipe()
	writer := multipart.NewWriter(pw)
	go func() {
		err := writeServiceImportMultipart(writer, body, source)
		closeWriterErr := writer.Close()
		if err != nil {
			_ = pw.CloseWithError(err)
			return
		}
		if closeWriterErr != nil {
			_ = pw.CloseWithError(closeWriterErr)
			return
		}
		_ = pw.Close()
	}()
	return c.doRequestWithClientReaderAndHeaders(&client, http.MethodPost, "/admin/v1/services/import", pr, map[string]string{
		"Accept":       "application/x-ndjson",
		"Content-Type": writer.FormDataContentType(),
	}, c.handleServiceImportStream)
}

func writeServiceImportMultipart(writer *multipart.Writer, body any, source localImportSource) error {
	options, err := writer.CreateFormField("options")
	if err != nil {
		return err
	}
	if err := json.NewEncoder(options).Encode(body); err != nil {
		return err
	}
	kind, err := writer.CreateFormField("upload_kind")
	if err != nil {
		return err
	}
	if _, err := io.WriteString(kind, string(source.UploadKind)); err != nil {
		return err
	}
	part, err := writer.CreateFormFile("package", filepath.Base(source.Path))
	if err != nil {
		return err
	}
	info, err := os.Stat(source.Path)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return writeImportDirectoryTarGz(source.Path, part)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("import source %q is not a regular file", source.Path)
	}
	file, err := os.Open(source.Path)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(part, file)
	closeErr := file.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

func writeImportDirectoryTarGz(src string, dst io.Writer) error {
	gz := gzip.NewWriter(dst)
	tw := tar.NewWriter(gz)
	walkErr := filepath.WalkDir(src, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == src {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		if !d.IsDir() && info.Mode().Type() != 0 {
			return nil
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		hdr, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		hdr.Name = filepath.ToSlash(filepath.Join("package", rel))
		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(tw, file)
		closeErr := file.Close()
		if copyErr != nil {
			return copyErr
		}
		return closeErr
	})
	closeTarErr := tw.Close()
	closeGzipErr := gz.Close()
	if walkErr != nil {
		return walkErr
	}
	if closeTarErr != nil {
		return closeTarErr
	}
	return closeGzipErr
}

func (c *CLI) requestStream(method, path string, body any) error {
	client := *c.Client
	client.Timeout = 0
	return c.doRequestWithClient(&client, method, path, body, func(resp *http.Response) error {
		_, err := io.Copy(c.Stdout, resp.Body)
		return err
	})
}

func (c *CLI) requestAndPrint(method, path string, body any, prettyJSON bool) error {
	return c.doRequest(method, path, body, func(resp *http.Response) error {
		respBody, err := io.ReadAll(resp.Body)
		if err != nil {
			return err
		}
		out := respBody
		if prettyJSON {
			out = redactJSON(respBody)
		}
		_, err = fmt.Fprintln(c.Stdout, string(out))
		return err
	})
}

func (c *CLI) doRequest(method, path string, body any, handle func(*http.Response) error) error {
	return c.doRequestWithClient(c.Client, method, path, body, handle)
}

func (c *CLI) doRequestWithClient(client *http.Client, method, path string, body any, handle func(*http.Response) error) error {
	return c.doRequestWithClientAndHeaders(client, method, path, body, nil, handle)
}

func (c *CLI) doRequestWithClientAndHeaders(client *http.Client, method, path string, body any, headers map[string]string, handle func(*http.Response) error) error {
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(b)
	}
	requestHeaders := map[string]string{"Content-Type": "application/json"}
	for key, value := range headers {
		requestHeaders[key] = value
	}
	return c.doRequestWithClientReaderAndHeaders(client, method, path, reader, requestHeaders, handle)
}

func (c *CLI) doRequestWithClientReaderAndHeaders(client *http.Client, method, path string, reader io.Reader, headers map[string]string, handle func(*http.Response) error) error {
	baseURL, err := adminBaseURL(c.AdminAddr)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(method, baseURL+path, reader)
	if err != nil {
		return err
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	if path != "/admin/v1/status" {
		token, err := c.adminToken()
		if err != nil {
			return err
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
	}
	resp, err := client.Do(req)
	if err != nil {
		var opErr *net.OpError
		if errors.As(err, &opErr) || strings.Contains(err.Error(), "connection refused") {
			return fmt.Errorf("octobus daemon is not running at %s; run `octobus serve` first", c.AdminAddr)
		}
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		respBody, err := io.ReadAll(resp.Body)
		if err != nil {
			return err
		}
		return fmt.Errorf("admin API failed: %s: %s", resp.Status, strings.TrimSpace(string(respBody)))
	}
	return handle(resp)
}

func (c *CLI) handleServiceImportStream(resp *http.Response) error {
	dec := json.NewDecoder(resp.Body)
	for {
		var event map[string]any
		if err := dec.Decode(&event); err != nil {
			if errors.Is(err, io.EOF) {
				return errors.New("service import stream ended without a complete event")
			}
			return err
		}
		eventType, _ := event["type"].(string)
		switch eventType {
		case "status", "progress":
			if err := c.printServiceImportProgress(event); err != nil {
				return err
			}
		case "error":
			msg, _ := event["error"].(string)
			if msg == "" {
				msg = "service import failed"
			}
			return errors.New(msg)
		case "complete":
			if err := c.printServiceImportComplete(event); err != nil {
				return err
			}
			if status, _ := event["status"].(string); status == "degraded" {
				return errors.New("service import completed with degraded status")
			}
			return nil
		default:
			return fmt.Errorf("unknown service import stream event type %q", eventType)
		}
	}
}

func (c *CLI) printServiceImportProgress(event map[string]any) error {
	message, _ := event["message"].(string)
	if message == "" {
		message, _ = event["stage"].(string)
	}
	if message == "" {
		return nil
	}
	if current, total := jsonNumberInt(event["current"]), jsonNumberInt(event["total"]); current > 0 && total > 0 {
		message = fmt.Sprintf("[%d/%d] %s", current, total, message)
	}
	if serviceID, _ := event["service_id"].(string); serviceID != "" {
		message = fmt.Sprintf("%s: %s", serviceID, message)
	}
	stderr := c.Stderr
	if stderr == nil {
		stderr = io.Discard
	}
	_, err := fmt.Fprintln(stderr, message)
	return err
}

func (c *CLI) printServiceImportComplete(event map[string]any) error {
	body := make(map[string]any, len(event)+1)
	for key, value := range event {
		if key == "type" || key == "stage" || key == "message" || key == "error" || key == "current" || key == "total" || key == "service_id" {
			continue
		}
		if key == "status" && value == "ok" {
			continue
		}
		body[key] = value
	}
	if services, ok := body["services"].([]any); ok {
		if _, exists := body["service_count"]; !exists {
			body["service_count"] = len(services)
		}
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintln(c.Stdout, string(redactJSON(raw)))
	return err
}

func jsonNumberInt(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	default:
		return 0
	}
}

func (c *CLI) adminToken() (string, error) {
	if token := strings.TrimSpace(os.Getenv("OCTOBUS_ADMIN_TOKEN")); token != "" {
		return token, nil
	}
	if token, err := readDotEnvAdminToken(".env"); err != nil {
		return "", err
	} else if token != "" {
		return token, nil
	}
	return readYAMLAdminToken(".octobus.yml")
}

func readDotEnvAdminToken(path string) (string, error) {
	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok || strings.TrimSpace(key) != "OCTOBUS_ADMIN_TOKEN" {
			continue
		}
		return strings.TrimSpace(strings.Trim(strings.TrimSpace(value), `"'`)), nil
	}
	return "", nil
}

func readYAMLAdminToken(path string) (string, error) {
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	var cfg map[string]any
	if err := yaml.Unmarshal(raw, &cfg); err != nil {
		return "", err
	}
	for _, key := range []string{"admin_token", "adminToken", "OCTOBUS_ADMIN_TOKEN"} {
		if v, ok := cfg[key]; ok {
			token, ok := v.(string)
			if !ok {
				return "", fmt.Errorf("%s in %s must be a string", key, path)
			}
			return strings.TrimSpace(token), nil
		}
	}
	return "", nil
}

func adminBaseURL(addr string) (string, error) {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		return "", errors.New("admin address is required")
	}
	rawAddr := addr
	if !strings.Contains(addr, "://") {
		addr = "http://" + addr
	}
	u, err := url.Parse(addr)
	if err != nil {
		return "", fmt.Errorf("invalid admin address %q: %w", rawAddr, err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", fmt.Errorf("invalid admin address %q: only http and https are supported", rawAddr)
	}
	if u.Host == "" {
		return "", fmt.Errorf("invalid admin address %q: missing host", rawAddr)
	}
	u.Path = ""
	u.RawQuery = ""
	u.Fragment = ""
	return u.String(), nil
}

func redactJSON(raw []byte) []byte {
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return raw
	}
	redactWalk(v)
	out, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return raw
	}
	return out
}

func redactWalk(v any) {
	switch x := v.(type) {
	case map[string]any:
		for k, val := range x {
			x[k] = redactFieldValue(k, val)
			if s, ok := x[k].(string); ok {
				x[k] = redactCredentialURLs(s)
				continue
			}
			redactWalk(x[k])
		}
	case []any:
		for idx, item := range x {
			if s, ok := item.(string); ok {
				x[idx] = redactCredentialURLs(s)
				continue
			}
			redactWalk(item)
		}
	}
}

func redactFieldValue(key string, value any) any {
	switch {
	case strings.EqualFold(key, "HasSecret"):
		return value
	case strings.EqualFold(key, "SecretSchemaPath"):
		return value
	}
	return domain.RedactConfigValue(key, value)
}

var credentialURLPattern = regexp.MustCompile(`https://([^/@:\s]+)(:[^/@\s]*)?@`)

func redactCredentialURLs(s string) string {
	return credentialURLPattern.ReplaceAllStringFunc(s, func(match string) string {
		trimmed := strings.TrimSuffix(strings.TrimPrefix(match, "https://"), "@")
		user, _, hasPassword := strings.Cut(trimmed, ":")
		if hasPassword {
			return "https://" + user + ":******@"
		}
		return "https://******@"
	})
}
