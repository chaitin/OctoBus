package domain

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var idPattern = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_-]{0,62}$`)

var ErrMethodNotUnary = errors.New("method is not a unary service method")

const ServiceManifestSchemaV1 = "chaitin.octobus.service.v1"

type InstanceStatus string

const (
	StatusStarting InstanceStatus = "starting"
	StatusRunning  InstanceStatus = "running"
	StatusDegraded InstanceStatus = "degraded"
	StatusStopped  InstanceStatus = "stopped"
	StatusFailed   InstanceStatus = "failed"
)

type RuntimeMode string

const (
	RuntimeModeLongRunning RuntimeMode = "long-running"
	RuntimeModeOnDemand    RuntimeMode = "on-demand"
	// RuntimeModeScaleToZero keeps a resident serve process warm between calls: the
	// first call starts it (supervisor EnsureStarted), the idle stopper parks
	// it after OCTOBUS_SCALE_TO_ZERO_IDLE_TTL. It trades the on-demand mode's guaranteed
	// cold isolation for a warm path, bounded by the warm-pool cap.
	RuntimeModeScaleToZero RuntimeMode = "scale-to-zero"
)

type Service struct {
	ID                  string
	Name                string
	PackageSource       string
	PackageArtifactPath string
	PackageSHA256       string
	PackageVersion      string
	ProtoBundlePath     string
	ProtoBundleSHA256   string
	DescriptorPath      string
	DescriptorSHA256    string
	DescriptorVersion   string
	Methods             []Method
	NodeEntry           string
	ServiceRoot         string
	RuntimeMode         RuntimeMode
	ConfigSchemaPath    string
	SecretSchemaPath    string
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

type Method struct {
	FullName        string `json:"full_name"`
	ServiceFullName string `json:"service_full_name"`
	Name            string `json:"name"`
	InputFullName   string `json:"input_full_name"`
	OutputFullName  string `json:"output_full_name"`
	ClientStreaming bool   `json:"client_streaming"`
	ServerStreaming bool   `json:"server_streaming"`
	Unary           bool   `json:"unary"`
	ProtoFile       string `json:"proto_file"`
}

type Instance struct {
	ID         string
	ServiceID  string
	Name       string
	Enabled    bool
	Status     InstanceStatus
	PID        *int
	ListenAddr string
	NodeEntry  string
	// RuntimeMode overrides the Service mode for this instance. Empty means
	// inherit; the effective mode is EffectiveRuntimeMode(service, instance).
	RuntimeMode  RuntimeMode
	ConfigJSON   json.RawMessage
	ConfigSHA256 string
	SecretJSON   json.RawMessage
	SecretSHA256 string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type Capset struct {
	ID          string
	Name        string
	Description string
	Enabled     bool
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type CapsetToken struct {
	ID         string
	CapsetID   string
	Name       string
	TokenHash  string
	CreatedAt  time.Time
	LastUsedAt time.Time
}

type AdminToken struct {
	ID         string
	Name       string
	TokenHash  string
	CreatedAt  time.Time
	LastUsedAt time.Time
}

type CapsetInstance struct {
	ID                string
	CapsetID          string
	ServiceID         string
	InstanceID        string
	Alias             string
	IncludeAllMethods bool
	Enabled           bool
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type CapsetMethod struct {
	ID               string
	CapsetInstanceID string
	MethodFullName   string
	RestAlias        string
	MCPToolName      string
	Enabled          bool
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type ServiceManifest struct {
	Schema       string          `json:"schema"`
	Name         string          `json:"name"`
	DisplayName  string          `json:"displayName"`
	Description  string          `json:"description"`
	Entry        string          `json:"entry"`
	Runtime      json.RawMessage `json:"runtime,omitempty"`
	SDK          json.RawMessage `json:"sdk,omitempty"`
	Proto        ManifestProto   `json:"proto"`
	ConfigSchema string          `json:"configSchema"`
	SecretSchema string          `json:"secretSchema"`
}

type ManifestRuntime struct {
	Mode RuntimeMode `json:"mode"`
}

type ManifestProto struct {
	Roots []string `json:"roots"`
	Files []string `json:"files"`
}

func ValidateID(kind, id string) error {
	if !idPattern.MatchString(id) {
		return fmt.Errorf("invalid %s id %q: must match %s", kind, id, idPattern.String())
	}
	return nil
}

func ValidateManifest(m ServiceManifest) error {
	if m.Schema == "" {
		return errors.New("service manifest missing schema")
	}
	if m.Schema != ServiceManifestSchemaV1 {
		return fmt.Errorf("invalid service manifest schema %q: must be %q", m.Schema, ServiceManifestSchemaV1)
	}
	if m.Name == "" {
		return errors.New("service manifest missing name")
	}
	if m.Entry != "" {
		return errors.New("service manifest must not define entry; use package.json bin")
	}
	if len(m.Proto.Roots) == 0 {
		return errors.New("service manifest missing proto.roots")
	}
	if len(m.Proto.Files) == 0 {
		return errors.New("service manifest missing proto.files")
	}
	for _, root := range m.Proto.Roots {
		if err := ValidatePackageRelativePath("proto root", root); err != nil {
			return fmt.Errorf("invalid proto root %q", root)
		}
	}
	for _, file := range m.Proto.Files {
		if err := ValidatePackageRelativePath("proto file", file); err != nil {
			return fmt.Errorf("invalid proto file %q", file)
		}
	}
	if m.ConfigSchema != "" {
		if err := ValidatePackageRelativePath("configSchema", m.ConfigSchema); err != nil {
			return fmt.Errorf("invalid configSchema %q: %w", m.ConfigSchema, err)
		}
	}
	if m.SecretSchema != "" {
		if err := ValidatePackageRelativePath("secretSchema", m.SecretSchema); err != nil {
			return fmt.Errorf("invalid secretSchema %q: %w", m.SecretSchema, err)
		}
	}
	if _, err := ManifestRuntimeMode(m); err != nil {
		return err
	}
	return nil
}

func ValidatePackageRelativePath(kind, value string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s must not be empty", kind)
	}
	if filepath.IsAbs(value) {
		return fmt.Errorf("%s must be relative", kind)
	}
	clean := filepath.Clean(value)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return fmt.Errorf("%s must stay inside package", kind)
	}
	for _, part := range strings.FieldsFunc(filepath.ToSlash(clean), func(r rune) bool { return r == '/' }) {
		if part == ".." {
			return fmt.Errorf("%s must not contain ..", kind)
		}
	}
	return nil
}

func ManifestRuntimeMode(m ServiceManifest) (RuntimeMode, error) {
	if len(m.Runtime) == 0 || string(m.Runtime) == "null" {
		return RuntimeModeLongRunning, nil
	}
	var runtime ManifestRuntime
	if err := json.Unmarshal(m.Runtime, &runtime); err != nil {
		return "", fmt.Errorf("invalid runtime: %w", err)
	}
	if runtime.Mode == "" {
		return RuntimeModeLongRunning, nil
	}
	if err := ValidateRuntimeMode(runtime.Mode); err != nil {
		return "", err
	}
	return runtime.Mode, nil
}

func ValidateRuntimeMode(mode RuntimeMode) error {
	switch mode {
	case RuntimeModeLongRunning, RuntimeModeOnDemand, RuntimeModeScaleToZero:
		return nil
	default:
		return fmt.Errorf("invalid runtime.mode %q: must be long-running, on-demand, or scale-to-zero", mode)
	}
}

// ValidateInstanceRuntimeMode accepts the empty override as "inherit the
// Service mode" in addition to the two concrete modes.
func ValidateInstanceRuntimeMode(mode RuntimeMode) error {
	if mode == "" {
		return nil
	}
	return ValidateRuntimeMode(mode)
}

// EffectiveRuntimeMode is the mode the supervisor and gateway must use for an
// instance: its own override when set, otherwise the Service's mode.
func EffectiveRuntimeMode(service Service, instance Instance) RuntimeMode {
	if instance.RuntimeMode != "" {
		return instance.RuntimeMode
	}
	if service.RuntimeMode == "" {
		return RuntimeModeLongRunning
	}
	return service.RuntimeMode
}

func HashBytes(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func DescriptorVersion(sha string) string {
	if len(sha) <= 12 {
		return sha
	}
	return sha[:12]
}

func ConfigHash(raw []byte) string {
	return HashBytes(raw)
}

func CapsetTokenHash(token string) string {
	return HashBytes([]byte(token))
}

func AdminTokenHash(token string) string {
	return HashBytes([]byte(token))
}

func MCPToolName(serviceID, instanceID, methodFullName string) string {
	method := methodFullName
	if idx := strings.LastIndex(method, "/"); idx >= 0 {
		method = method[idx+1:]
	}
	return serviceID + "__" + instanceID + "__" + toSnake(method)
}

func toSnake(s string) string {
	var b strings.Builder
	for i, r := range s {
		if r >= 'A' && r <= 'Z' {
			if i > 0 {
				b.WriteByte('_')
			}
			b.WriteRune(r + ('a' - 'A'))
			continue
		}
		if r == '-' || r == ' ' || r == '.' || r == '/' {
			if b.Len() > 0 && !strings.HasSuffix(b.String(), "_") {
				b.WriteByte('_')
			}
			continue
		}
		b.WriteRune(r)
	}
	return strings.Trim(b.String(), "_")
}

func RedactConfigValue(key string, value any) any {
	lower := strings.ToLower(key)
	for _, marker := range []string{"password", "token", "secret", "key"} {
		if strings.Contains(lower, marker) {
			return "******"
		}
	}
	return value
}
