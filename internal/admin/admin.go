package admin

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v5"

	"octobus/internal/accesslog"
	"octobus/internal/daemonlog"
	"octobus/internal/domain"
	"octobus/internal/packageimport"
	"octobus/internal/protocol"
	"octobus/internal/store"
	"octobus/internal/supervisor"
)

type Server struct {
	Store         *store.Store
	Importer      serviceImporter
	Supervisor    *supervisor.Supervisor
	Gateway       *protocol.Gateway
	AccessLogPath string
	Logger        *slog.Logger
}

type serviceImporter interface {
	Import(context.Context, packageimport.Options) (packageimport.Result, error)
	ImportRecursive(context.Context, packageimport.Options) (packageimport.RecursiveResult, error)
}

type serviceImportMultipartLimits struct {
	OptionsBytes    int64
	UploadKindBytes int64
	PackageBytes    int64
}

var defaultServiceImportMultipartLimits = serviceImportMultipartLimits{
	OptionsBytes:    16 << 20,
	UploadKindBytes: 64 << 10,
	PackageBytes:    4 << 30,
}

type instanceResponse struct {
	ID           string                `json:"ID"`
	ServiceID    string                `json:"ServiceID"`
	Name         string                `json:"Name"`
	Enabled      bool                  `json:"Enabled"`
	Status       domain.InstanceStatus `json:"Status"`
	PID          *int                  `json:"PID,omitempty"`
	ListenAddr   string                `json:"ListenAddr"`
	NodeEntry    string                `json:"NodeEntry"`
	ConfigJSON   json.RawMessage       `json:"ConfigJSON"`
	ConfigSHA256 string                `json:"ConfigSHA256"`
	SecretSHA256 string                `json:"SecretSHA256"`
	HasSecret    bool                  `json:"HasSecret"`
	CreatedAt    time.Time             `json:"CreatedAt"`
	UpdatedAt    time.Time             `json:"UpdatedAt"`
}

func newInstanceResponse(inst domain.Instance) instanceResponse {
	return instanceResponse{
		ID:           inst.ID,
		ServiceID:    inst.ServiceID,
		Name:         inst.Name,
		Enabled:      inst.Enabled,
		Status:       inst.Status,
		PID:          inst.PID,
		ListenAddr:   inst.ListenAddr,
		NodeEntry:    inst.NodeEntry,
		ConfigJSON:   inst.ConfigJSON,
		ConfigSHA256: inst.ConfigSHA256,
		SecretSHA256: inst.SecretSHA256,
		HasSecret:    len(inst.SecretJSON) > 0 && string(inst.SecretJSON) != "{}",
		CreatedAt:    inst.CreatedAt,
		UpdatedAt:    inst.UpdatedAt,
	}
}

func newInstanceResponses(instances []domain.Instance) []instanceResponse {
	out := make([]instanceResponse, len(instances))
	for i, inst := range instances {
		out[i] = newInstanceResponse(inst)
	}
	return out
}

func (s *Server) Handler() http.Handler {
	e := echo.New()
	e.HTTPErrorHandler = func(c *echo.Context, err error) {
		writeError(c.Response(), echoErrorStatus(err), "unknown admin route")
	}
	e.GET("/admin/v1/status", s.echoStatus)
	e.Use(s.adminTokenMiddleware)
	e.GET("/admin/v1/catalog/:capset_id", s.echoCatalog)
	e.GET("/admin/v1/catalog/:capset_id/openapi.json", s.echoCatalogOpenAPIJSON)
	e.GET("/admin/v1/catalog/:capset_id/openapi.yaml", s.echoCatalogOpenAPIYAML)
	e.GET("/admin/v1/logs/access", s.echoAccessLogs)
	e.GET("/admin/v1/tokens", s.echoAdminTokens)
	e.POST("/admin/v1/tokens", s.echoAdminTokens)
	e.GET("/admin/v1/tokens/:token_id", s.echoAdminToken)
	e.DELETE("/admin/v1/tokens/:token_id", s.echoAdminToken)
	e.POST("/admin/v1/services/import", s.echoServiceImport)
	e.GET("/admin/v1/services", s.echoServices)
	e.GET("/admin/v1/services/:service_id", s.echoServicePath)
	e.PATCH("/admin/v1/services/:service_id", s.echoServicePath)
	e.DELETE("/admin/v1/services/:service_id", s.echoServicePath)
	e.GET("/admin/v1/services/:service_id/schema", s.echoServiceSchema)
	e.GET("/admin/v1/instances", s.echoInstances)
	e.POST("/admin/v1/instances", s.echoInstances)
	e.GET("/admin/v1/instances/:instance_id", s.echoInstancePath)
	e.PATCH("/admin/v1/instances/:instance_id", s.echoInstancePath)
	e.DELETE("/admin/v1/instances/:instance_id", s.echoInstancePath)
	e.POST("/admin/v1/instances/:instance_id/:action", s.echoInstanceAction)
	e.GET("/admin/v1/capsets", s.echoCapsets)
	e.POST("/admin/v1/capsets", s.echoCapsets)
	e.GET("/admin/v1/capsets/:capset_id", s.echoCapsetPath)
	e.PATCH("/admin/v1/capsets/:capset_id", s.echoCapsetPath)
	e.DELETE("/admin/v1/capsets/:capset_id", s.echoCapsetPath)
	e.GET("/admin/v1/capsets/:capset_id/instances", s.echoCapsetInstances)
	e.POST("/admin/v1/capsets/:capset_id/instances", s.echoCapsetInstances)
	e.DELETE("/admin/v1/capsets/:capset_id/instances/:instance_id", s.echoCapsetInstance)
	e.GET("/admin/v1/capsets/:capset_id/methods", s.echoCapsetMethods)
	e.POST("/admin/v1/capsets/:capset_id/methods", s.echoCapsetMethods)
	e.DELETE("/admin/v1/capsets/:capset_id/methods", s.echoCapsetMethods)
	e.GET("/admin/v1/capsets/:capset_id/tokens", s.echoCapsetTokens)
	e.POST("/admin/v1/capsets/:capset_id/tokens", s.echoCapsetTokens)
	e.DELETE("/admin/v1/capsets/:capset_id/tokens/:token_id", s.echoCapsetToken)
	return e
}

func (s *Server) adminTokenMiddleware(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c *echo.Context) error {
		if c.Request().URL.Path == "/admin/v1/status" {
			return next(c)
		}
		requires, err := s.Store.AdminRequiresToken(c.Request().Context())
		if err != nil {
			writeError(c.Response(), http.StatusInternalServerError, err.Error())
			return nil
		}
		if !requires {
			return next(c)
		}
		ok, err := s.Store.VerifyAdminToken(c.Request().Context(), bearerToken(c.Request().Header.Get("Authorization")))
		if err != nil {
			writeError(c.Response(), http.StatusInternalServerError, err.Error())
			return nil
		}
		if !ok {
			writeError(c.Response(), http.StatusUnauthorized, "admin token is required")
			return nil
		}
		return next(c)
	}
}

func (s *Server) handleAccessLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	filter, err := parseAccessLogQuery(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	path := s.AccessLogPath
	if path == "" && s.Gateway != nil && s.Gateway.DataDir != "" {
		path = filepath.Join(s.Gateway.DataDir, accesslog.FileName)
	}
	if path == "" {
		writeError(w, http.StatusInternalServerError, "access log path is not configured")
		return
	}
	if filter.Follow {
		w.Header().Set("Content-Type", accesslog.ContentType)
		w.WriteHeader(http.StatusOK)
		err := accesslog.FollowFile(path, filter, flushResponseWriter{ResponseWriter: w}, r.Context().Done())
		if err != nil && !errors.Is(err, context.Canceled) {
			s.logger().Warn("access_log_follow_failed", "error", err)
			fmt.Fprintf(w, `{"error":{"code":"ACCESS_LOG_FOLLOW_FAILED","message":%q,"details":{}}}`+"\n", err.Error())
		}
		return
	}
	var out bytes.Buffer
	if err := accesslog.ReadFile(path, filter, &out); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", accesslog.ContentType)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(out.Bytes())
}

func parseAccessLogQuery(r *http.Request) (accesslog.Filter, error) {
	q := r.URL.Query()
	filter := accesslog.Filter{
		Capset:   q.Get("capset"),
		Instance: q.Get("instance"),
		Service:  q.Get("service"),
	}
	if _, ok := q["limit"]; ok {
		raw := q.Get("limit")
		if raw == "" {
			return accesslog.Filter{}, fmt.Errorf("limit must be non-negative")
		}
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 0 {
			return accesslog.Filter{}, fmt.Errorf("limit must be non-negative")
		}
		filter.Limit = limit
		filter.LimitSet = true
	}
	if _, ok := q["tail"]; ok {
		raw := q.Get("tail")
		if raw == "" {
			return accesslog.Filter{}, fmt.Errorf("tail must be non-negative")
		}
		tail, err := strconv.Atoi(raw)
		if err != nil || tail < 0 {
			return accesslog.Filter{}, fmt.Errorf("tail must be non-negative")
		}
		filter.Tail = tail
		filter.TailSet = true
	}
	if filter.LimitSet && filter.TailSet {
		return accesslog.Filter{}, fmt.Errorf("limit and tail are mutually exclusive")
	}
	if _, ok := q["follow"]; ok {
		follow, err := parseBoolQuery(q.Get("follow"), "follow")
		if err != nil {
			return accesslog.Filter{}, err
		}
		filter.Follow = follow
	}
	if filter.Follow && filter.LimitSet {
		return accesslog.Filter{}, fmt.Errorf("limit and follow are mutually exclusive")
	}
	if filter.Follow && !filter.LimitSet && !filter.TailSet {
		filter.Tail = accesslog.DefaultLimit
		filter.TailSet = true
	}
	return filter, nil
}

func (s *Server) echoAccessLogs(c *echo.Context) error {
	s.handleAccessLogs(c.Response(), c.Request())
	return nil
}

type flushResponseWriter struct {
	http.ResponseWriter
}

func (w flushResponseWriter) Flush() {
	_ = http.NewResponseController(w.ResponseWriter).Flush()
}

func (s *Server) handleCatalog(w http.ResponseWriter, r *http.Request, capsetID string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if s.Gateway == nil {
		writeError(w, http.StatusInternalServerError, "protocol gateway is not configured")
		return
	}
	opts, format, err := parseCatalogQuery(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	cat, err := s.Gateway.CatalogWithOptions(r.Context(), capsetID, opts)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	if format == "md" {
		w.Header().Set("Content-Type", "text/markdown")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(protocol.RenderCatalogMarkdown(cat))
		return
	}
	writeJSON(w, http.StatusOK, cat)
}

func parseCatalogQuery(r *http.Request) (protocol.CatalogOptions, string, error) {
	q := r.URL.Query()
	format := q.Get("format")
	if format == "" {
		format = "json"
	}
	if format != "json" && format != "md" {
		return protocol.CatalogOptions{}, "", fmt.Errorf("format must be json or md")
	}
	grpc, err := parseBoolQuery(q.Get("grpc"), "grpc")
	if err != nil {
		return protocol.CatalogOptions{}, "", err
	}
	mcp, err := parseBoolQuery(q.Get("mcp"), "mcp")
	if err != nil {
		return protocol.CatalogOptions{}, "", err
	}
	connectRPC, err := parseBoolQuery(q.Get("connect"), "connect")
	if err != nil {
		return protocol.CatalogOptions{}, "", err
	}
	all, err := parseBoolQuery(q.Get("all"), "all")
	if err != nil {
		return protocol.CatalogOptions{}, "", err
	}
	if all && (grpc || mcp || connectRPC) {
		return protocol.CatalogOptions{}, "", fmt.Errorf("all is mutually exclusive with grpc, mcp, and connect")
	}
	if all {
		return protocol.CatalogOptions{IncludeGRPC: true, IncludeMCP: true, IncludeConnect: true}, format, nil
	}
	if !grpc && !mcp && !connectRPC {
		grpc = true
	}
	return protocol.CatalogOptions{IncludeGRPC: grpc, IncludeMCP: mcp, IncludeConnect: connectRPC}, format, nil
}

func parseBoolQuery(value, name string) (bool, error) {
	switch value {
	case "":
		return false, nil
	case "true":
		return true, nil
	case "false":
		return false, nil
	default:
		return false, fmt.Errorf("%s must be true or false", name)
	}
}

func (s *Server) handleCatalogOpenAPI(w http.ResponseWriter, r *http.Request, capsetID, format string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if s.Gateway == nil {
		writeError(w, http.StatusInternalServerError, "protocol gateway is not configured")
		return
	}
	raw, err := s.Gateway.OpenAPI(r.Context(), capsetID, format)
	if err != nil {
		writeCatalogError(w, err)
		return
	}
	if format == "json" {
		w.Header().Set("Content-Type", "application/json")
	} else {
		w.Header().Set("Content-Type", "application/yaml")
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(raw)
}

func writeCatalogError(w http.ResponseWriter, err error) {
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeError(w, http.StatusInternalServerError, err.Error())
}

func (s *Server) echoCatalog(c *echo.Context) error {
	s.handleCatalog(c.Response(), c.Request(), c.Param("capset_id"))
	return nil
}

func (s *Server) echoCatalogOpenAPIJSON(c *echo.Context) error {
	s.handleCatalogOpenAPI(c.Response(), c.Request(), c.Param("capset_id"), "json")
	return nil
}

func (s *Server) echoCatalogOpenAPIYAML(c *echo.Context) error {
	s.handleCatalogOpenAPI(c.Response(), c.Request(), c.Param("capset_id"), "yaml")
	return nil
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	services, err := s.Store.CountServices(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "services": services})
}

func (s *Server) echoStatus(c *echo.Context) error {
	s.handleStatus(c.Response(), c.Request())
	return nil
}

func (s *Server) handleServiceImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	req, cleanup, err := readServiceImportRequest(r)
	if cleanup != nil {
		defer cleanup()
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if acceptsNDJSON(r) {
		s.handleStreamingServiceImport(w, r, req)
		return
	}
	if req.Recursive {
		s.handleRecursiveServiceImport(w, r, req)
		return
	}
	s.logger().Info("service_import_started", "service_id", req.ServiceID, "offline", req.Offline, "reinstall", req.Reinstall, "build", req.Build)
	res, err := s.Importer.Import(r.Context(), req)
	if err != nil {
		msg := serviceImportErrorMessage(err, req)
		s.logger().Warn("service_import_failed", "service_id", req.ServiceID, "error", msg)
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	s.logger().Info("service_import_done", "service_id", res.Service.ID, "runtime_mode", res.Service.RuntimeMode, "descriptor_sha256", res.Service.DescriptorSHA256, "method_count", len(res.Service.Methods))
	restarted, restartErrs := s.restartEnabledServiceInstances(r.Context(), res.Service.ID)
	if len(restartErrs) > 0 {
		writeJSON(w, http.StatusConflict, map[string]any{"service": res.Service, "restarted_instances": restarted, "restart_errors": restartErrs, "status": "degraded"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"service": res.Service, "restarted_instances": restarted, "restart_errors": restartErrs})
}

func readServiceImportRequest(r *http.Request) (packageimport.Options, func(), error) {
	contentType := r.Header.Get("Content-Type")
	if contentType == "" {
		var req packageimport.Options
		return req, nil, readJSON(r, &req)
	}
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		return packageimport.Options{}, nil, fmt.Errorf("invalid service import content type: %w", err)
	}
	switch mediaType {
	case "application/json":
		var req packageimport.Options
		return req, nil, readJSON(r, &req)
	case "multipart/form-data":
		return readMultipartServiceImport(r)
	default:
		return packageimport.Options{}, nil, fmt.Errorf("unsupported service import content type %q: expected application/json or multipart/form-data", mediaType)
	}
}

func readMultipartServiceImport(r *http.Request) (packageimport.Options, func(), error) {
	mr, err := r.MultipartReader()
	if err != nil {
		return packageimport.Options{}, nil, fmt.Errorf("read multipart service import: %w", err)
	}
	var req packageimport.Options
	var uploadKind packageimport.UploadKind
	var uploadPath string
	var tempDir string
	var haveOptions, haveUploadKind, havePackage bool
	cleanup := func() {
		if tempDir != "" {
			_ = os.RemoveAll(tempDir)
		}
	}
	fail := func(err error) (packageimport.Options, func(), error) {
		cleanup()
		return packageimport.Options{}, nil, err
	}
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return fail(fmt.Errorf("read multipart service import: %w", err))
		}
		switch part.FormName() {
		case "options":
			if haveOptions {
				return fail(errors.New("multipart service import contains duplicate options part"))
			}
			raw, err := readLimitedMultipartPart(part, defaultServiceImportMultipartLimits.OptionsBytes, "options")
			if err != nil {
				return fail(err)
			}
			if err := decodeStrictJSON(bytes.NewReader(raw), &req); err != nil {
				return fail(fmt.Errorf("decode multipart options: %w", err))
			}
			haveOptions = true
		case "upload_kind":
			if haveUploadKind {
				return fail(errors.New("multipart service import contains duplicate upload_kind field"))
			}
			raw, err := readLimitedMultipartPart(part, defaultServiceImportMultipartLimits.UploadKindBytes, "upload_kind")
			if err != nil {
				return fail(err)
			}
			uploadKind, err = parseMultipartUploadKind(strings.TrimSpace(string(raw)))
			if err != nil {
				return fail(err)
			}
			haveUploadKind = true
		case "package":
			if havePackage {
				return fail(errors.New("multipart service import contains duplicate package part"))
			}
			if tempDir == "" {
				tempDir, err = os.MkdirTemp("", "octobus-service-import-*")
				if err != nil {
					return fail(fmt.Errorf("create service import upload temp dir: %w", err))
				}
			}
			uploadPath = filepath.Join(tempDir, "package")
			out, err := os.OpenFile(uploadPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
			if err != nil {
				return fail(fmt.Errorf("create service import upload file: %w", err))
			}
			_, copyErr := copyLimitedMultipartPart(out, part, defaultServiceImportMultipartLimits.PackageBytes, "package")
			closeErr := out.Close()
			if copyErr != nil {
				return fail(fmt.Errorf("save service import upload: %w", copyErr))
			}
			if closeErr != nil {
				return fail(fmt.Errorf("save service import upload: %w", closeErr))
			}
			havePackage = true
		case "":
			return fail(errors.New("multipart service import contains unnamed part"))
		default:
			return fail(fmt.Errorf("unexpected multipart service import field %q", part.FormName()))
		}
	}
	if !haveOptions {
		return fail(errors.New("multipart service import options part is required"))
	}
	if !haveUploadKind {
		return fail(errors.New("multipart service import upload_kind field is required"))
	}
	if !havePackage {
		return fail(errors.New("multipart service import package part is required"))
	}
	req.Upload = &packageimport.UploadedSource{
		Kind:          uploadKind,
		Path:          uploadPath,
		DisplaySource: req.Source,
	}
	return req, cleanup, nil
}

func readLimitedMultipartPart(src io.Reader, limit int64, label string) ([]byte, error) {
	var dst bytes.Buffer
	if _, err := copyLimitedMultipartPart(&dst, src, limit, label); err != nil {
		return nil, err
	}
	return dst.Bytes(), nil
}

func copyLimitedMultipartPart(dst io.Writer, src io.Reader, limit int64, label string) (int64, error) {
	if limit < 0 {
		return 0, fmt.Errorf("multipart service import %s size limit is invalid", label)
	}
	reader := &io.LimitedReader{R: src, N: limit + 1}
	written, err := io.Copy(dst, reader)
	if err != nil {
		return written, fmt.Errorf("read multipart service import %s: %w", label, err)
	}
	if written > limit {
		return written, fmt.Errorf("multipart service import %s exceeds size limit of %d bytes", label, limit)
	}
	return written, nil
}

func parseMultipartUploadKind(raw string) (packageimport.UploadKind, error) {
	switch kind := packageimport.UploadKind(raw); kind {
	case packageimport.UploadKindDirectory, packageimport.UploadKindArchive, packageimport.UploadKindNPMLocal:
		return kind, nil
	default:
		return "", fmt.Errorf("invalid multipart service import upload_kind %q: expected directory, archive, or npm-local", raw)
	}
}

func serviceImportErrorMessage(err error, req packageimport.Options) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	if req.Upload == nil || req.Upload.Path == "" {
		return msg
	}
	uploadPath := req.Upload.Path
	msg = strings.ReplaceAll(msg, uploadPath, "<uploaded package>")
	uploadDir := filepath.Dir(uploadPath)
	if uploadDir != "." && uploadDir != "" {
		msg = strings.ReplaceAll(msg, uploadDir, "<upload temp dir>")
	}
	return msg
}

func (s *Server) handleRecursiveServiceImport(w http.ResponseWriter, r *http.Request, req packageimport.Options) {
	if req.Source == "" {
		writeError(w, http.StatusBadRequest, "service package source is required")
		return
	}
	if req.ServiceID != "" {
		writeError(w, http.StatusBadRequest, "service_id cannot be used with recursive import")
		return
	}
	if req.Name != "" {
		writeError(w, http.StatusBadRequest, "name cannot be used with recursive import")
		return
	}
	s.logger().Info("service_import_recursive_started", "offline", req.Offline, "reinstall", req.Reinstall, "build", req.Build)
	res, err := s.Importer.ImportRecursive(r.Context(), req)
	if err != nil {
		msg := serviceImportErrorMessage(err, req)
		s.logger().Warn("service_import_recursive_failed", "error", msg)
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	s.logger().Info("service_import_recursive_done", "service_count", len(res.Services))
	restartedByService := make(map[string][]string, len(res.Services))
	restartErrsByService := make(map[string][]string, len(res.Services))
	degraded := false
	for _, svc := range res.Services {
		restarted, restartErrs := s.restartEnabledServiceInstances(r.Context(), svc.ID)
		if restarted == nil {
			restarted = []string{}
		}
		if restartErrs == nil {
			restartErrs = []string{}
		}
		restartedByService[svc.ID] = restarted
		restartErrsByService[svc.ID] = restartErrs
		if len(restartErrs) > 0 {
			degraded = true
		}
	}
	serviceCount := res.ServiceCount
	if serviceCount == 0 {
		serviceCount = len(res.Services)
	}
	body := map[string]any{"services": res.Services, "service_count": serviceCount, "restarted_instances": restartedByService, "restart_errors": restartErrsByService}
	if degraded {
		body["status"] = "degraded"
		writeJSON(w, http.StatusConflict, body)
		return
	}
	writeJSON(w, http.StatusOK, body)
}

func (s *Server) echoServiceImport(c *echo.Context) error {
	s.handleServiceImport(c.Response(), c.Request())
	return nil
}

func (s *Server) handleStreamingServiceImport(w http.ResponseWriter, r *http.Request, req packageimport.Options) {
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.WriteHeader(http.StatusOK)
	if err := flushHTTP(w); err != nil {
		return
	}
	writeEvent := func(event packageimport.ImportProgressEvent) error {
		return writeNDJSONEvent(w, event)
	}
	req.Progress = writeEvent
	if req.Recursive {
		s.handleStreamingRecursiveServiceImport(w, r, req, writeEvent)
		return
	}
	s.logger().Info("service_import_started", "service_id", req.ServiceID, "offline", req.Offline, "reinstall", req.Reinstall, "build", req.Build)
	res, err := s.Importer.Import(r.Context(), req)
	if err != nil {
		msg := serviceImportErrorMessage(err, req)
		s.logger().Warn("service_import_failed", "service_id", req.ServiceID, "error", msg)
		_ = writeEvent(packageimport.ImportProgressEvent{Type: "error", Error: msg})
		return
	}
	s.logger().Info("service_import_done", "service_id", res.Service.ID, "runtime_mode", res.Service.RuntimeMode, "descriptor_sha256", res.Service.DescriptorSHA256, "method_count", len(res.Service.Methods))
	if err := writeEvent(packageimport.ImportProgressEvent{Type: "status", Stage: "restart_instances", Message: "Restarting enabled service instances", ServiceID: res.Service.ID}); err != nil {
		return
	}
	restarted, restartErrs := s.restartEnabledServiceInstances(r.Context(), res.Service.ID)
	if restarted == nil {
		restarted = []string{}
	}
	if restartErrs == nil {
		restartErrs = []string{}
	}
	status := "ok"
	if len(restartErrs) > 0 {
		status = "degraded"
	}
	_ = writeEvent(packageimport.ImportProgressEvent{Type: "complete", Status: status, Service: &res.Service, RestartedInstances: restarted, RestartErrors: restartErrs})
}

func (s *Server) handleStreamingRecursiveServiceImport(w http.ResponseWriter, r *http.Request, req packageimport.Options, writeEvent func(packageimport.ImportProgressEvent) error) {
	s.logger().Info("service_import_recursive_started", "offline", req.Offline, "reinstall", req.Reinstall, "build", req.Build)
	res, err := s.Importer.ImportRecursive(r.Context(), req)
	if err != nil {
		msg := serviceImportErrorMessage(err, req)
		s.logger().Warn("service_import_recursive_failed", "error", msg)
		_ = writeEvent(packageimport.ImportProgressEvent{Type: "error", Error: msg})
		return
	}
	s.logger().Info("service_import_recursive_done", "service_count", len(res.Services))
	restartedByService := make(map[string][]string, len(res.Services))
	restartErrsByService := make(map[string][]string, len(res.Services))
	degraded := false
	for idx, svc := range res.Services {
		if err := writeEvent(packageimport.ImportProgressEvent{Type: "status", Stage: "restart_instances", Message: "Restarting enabled service instances", ServiceID: svc.ID, Current: idx + 1, Total: len(res.Services)}); err != nil {
			return
		}
		restarted, restartErrs := s.restartEnabledServiceInstances(r.Context(), svc.ID)
		if restarted == nil {
			restarted = []string{}
		}
		if restartErrs == nil {
			restartErrs = []string{}
		}
		restartedByService[svc.ID] = restarted
		restartErrsByService[svc.ID] = restartErrs
		if len(restartErrs) > 0 {
			degraded = true
		}
	}
	status := "ok"
	if degraded {
		status = "degraded"
	}
	_ = writeEvent(packageimport.ImportProgressEvent{Type: "complete", Status: status, Services: res.Services, RestartedInstances: restartedByService, RestartErrors: restartErrsByService})
}

func (s *Server) handleAdminTokens(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		items, err := s.Store.ListAdminTokens(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"tokens": items})
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		ID     string `json:"id"`
		Name   string `json:"name"`
		Secret string `json:"token"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.ID == "" || req.Secret == "" {
		writeError(w, http.StatusBadRequest, "token id and token are required")
		return
	}
	token, err := s.Store.AddAdminToken(r.Context(), domain.AdminToken{ID: req.ID, Name: req.Name}, req.Secret)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.logger().Info("admin_token_created", "token_id", token.ID)
	writeJSON(w, http.StatusOK, token)
}

func (s *Server) handleAdminToken(w http.ResponseWriter, r *http.Request, tokenID string) {
	if tokenID == "" {
		writeError(w, http.StatusNotFound, "admin token not found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		token, err := s.Store.GetAdminToken(r.Context(), tokenID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				writeError(w, http.StatusNotFound, "admin token not found")
				return
			}
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, token)
	case http.MethodDelete:
		if err := s.Store.DeleteAdminToken(r.Context(), tokenID); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		s.logger().Info("admin_token_deleted", "token_id", tokenID)
		writeJSON(w, http.StatusOK, map[string]any{"deleted": true, "token_id": tokenID})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) echoAdminTokens(c *echo.Context) error {
	s.handleAdminTokens(c.Response(), c.Request())
	return nil
}

func (s *Server) echoAdminToken(c *echo.Context) error {
	s.handleAdminToken(c.Response(), c.Request(), c.Param("token_id"))
	return nil
}

func (s *Server) handleServices(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	services, err := s.Store.ListServices(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"services": services})
}

func (s *Server) echoServices(c *echo.Context) error {
	s.handleServices(c.Response(), c.Request())
	return nil
}

func (s *Server) handleServicePath(w http.ResponseWriter, r *http.Request, serviceID string) {
	if serviceID == "" {
		writeError(w, http.StatusNotFound, "unknown service route")
		return
	}
	switch r.Method {
	case http.MethodGet:
		svc, err := s.Store.GetService(r.Context(), serviceID)
		if err != nil {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, svc)
	case http.MethodPatch:
		var req struct {
			Name string `json:"name"`
		}
		if err := readJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		svc, err := s.Store.UpdateServiceMetadata(r.Context(), serviceID, req.Name)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		s.logger().Info("service_metadata_updated", "service_id", serviceID)
		writeJSON(w, http.StatusOK, svc)
	case http.MethodDelete:
		if err := s.Store.DeleteService(r.Context(), serviceID); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		s.logger().Info("service_deleted", "service_id", serviceID)
		writeJSON(w, http.StatusOK, map[string]any{"deleted": true, "service_id": serviceID})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) echoServicePath(c *echo.Context) error {
	s.handleServicePath(c.Response(), c.Request(), c.Param("service_id"))
	return nil
}

func (s *Server) echoServiceSchema(c *echo.Context) error {
	s.handleServiceSchema(c.Response(), c.Request(), c.Param("service_id"))
	return nil
}

// handleServiceSchema returns the JSON Schema documents a service declares for
// its instance config and secret, so management clients (e.g. fde-admin) can
// render typed config forms instead of asking users to hand-write JSON. Only the
// schema documents are returned — never the daemon-side file paths. A null field
// means the service declared no such schema. Schemas are JSON Schema Draft
// 2020-12 and carry structure only (no instance secret values).
func (s *Server) handleServiceSchema(w http.ResponseWriter, r *http.Request, serviceID string) {
	if serviceID == "" {
		writeError(w, http.StatusNotFound, "unknown service route")
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	svc, err := s.Store.GetService(r.Context(), serviceID)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	configSchema, err := readSchemaContent(svc.ConfigSchemaPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	secretSchema, err := readSchemaContent(svc.SecretSchemaPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"service_id": serviceID,
		"config":     configSchema,
		"secret":     secretSchema,
	})
}

// readSchemaContent reads a schema file declared by a service manifest. An empty
// path means the service declared no such schema and yields nil (serialized as
// null). The path is daemon-absolute (resolved at import time); only the file
// content is returned, never the path. The content is validated as JSON so
// clients never receive a truncated or corrupt schema document.
func readSchemaContent(path string) (json.RawMessage, error) {
	if path == "" {
		return nil, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read schema file: %w", err)
	}
	if !json.Valid(data) {
		return nil, fmt.Errorf("schema file is not valid JSON")
	}
	return json.RawMessage(data), nil
}

func (s *Server) restartEnabledServiceInstances(ctx context.Context, serviceID string) ([]string, []string) {
	if s.Supervisor == nil {
		return nil, nil
	}
	svc, err := s.Store.GetService(ctx, serviceID)
	if err != nil {
		return nil, []string{err.Error()}
	}
	if svc.RuntimeMode == domain.RuntimeModeOnDemand {
		return []string{}, []string{}
	}
	instances, err := s.Store.ListEnabledInstancesByService(ctx, serviceID)
	if err != nil {
		return nil, []string{err.Error()}
	}
	s.logger().Info("service_instances_restart_started", "service_id", serviceID, "count", len(instances))
	var restarted []string
	errsByInstance := make(map[string]string)
	errs := supervisor.RunBounded(instanceIDs(instances), 4, func(id string) error {
		if err := s.Supervisor.Restart(ctx, id); err != nil {
			return fmt.Errorf("%s: %w", id, err)
		}
		return nil
	})
	for _, err := range errs {
		parts := strings.SplitN(err.Error(), ": ", 2)
		if len(parts) == 2 {
			errsByInstance[parts[0]] = err.Error()
		}
	}
	for _, inst := range instances {
		if msg := errsByInstance[inst.ID]; msg != "" {
			continue
		}
		restarted = append(restarted, inst.ID)
	}
	var errStrings []string
	for _, inst := range instances {
		if msg := errsByInstance[inst.ID]; msg != "" {
			errStrings = append(errStrings, msg)
		}
	}
	if len(errStrings) > 0 {
		s.logger().Warn("service_instances_restart_failed", "service_id", serviceID, "failed_count", len(errStrings), "error", strings.Join(errStrings, "; "))
	}
	s.logger().Info("service_instances_restart_done", "service_id", serviceID, "restarted_count", len(restarted), "failed_count", len(errStrings))
	return restarted, errStrings
}

func instanceIDs(instances []domain.Instance) []string {
	ids := make([]string, len(instances))
	for i, inst := range instances {
		ids[i] = inst.ID
	}
	return ids
}

func (s *Server) handleInstances(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		instances, err := s.Store.ListInstances(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"instances": newInstanceResponses(instances)})
	case http.MethodPost:
		var req supervisor.CreateInstanceRequest
		if err := readJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		inst, err := s.Supervisor.CreateInstance(r.Context(), req)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, newInstanceResponse(inst))
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) echoInstances(c *echo.Context) error {
	s.handleInstances(c.Response(), c.Request())
	return nil
}

func (s *Server) handleInstancePath(w http.ResponseWriter, r *http.Request, instanceID, action string) {
	if instanceID != "" && action == "" {
		switch r.Method {
		case http.MethodGet:
			inst, err := s.Store.GetInstance(r.Context(), instanceID)
			if err != nil {
				writeError(w, http.StatusNotFound, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, newInstanceResponse(inst))
		case http.MethodPatch:
			var req struct {
				Name string `json:"name"`
			}
			if err := readJSON(r, &req); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			inst, err := s.Store.GetInstance(r.Context(), instanceID)
			if err != nil {
				writeError(w, http.StatusNotFound, err.Error())
				return
			}
			if req.Name == "" {
				writeError(w, http.StatusBadRequest, "instance name is required")
				return
			}
			inst.Name = req.Name
			if err := s.Store.UpsertInstance(r.Context(), inst); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			updated, err := s.Store.GetInstance(r.Context(), instanceID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, newInstanceResponse(updated))
		case http.MethodDelete:
			if err := s.Supervisor.DeleteInstance(r.Context(), instanceID); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"deleted": true, "instance_id": instanceID})
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
		return
	}
	if instanceID == "" || action == "" {
		writeError(w, http.StatusNotFound, "unknown instance action")
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var err error
	switch action {
	case "start":
		err = s.Supervisor.Start(r.Context(), instanceID)
	case "stop":
		err = s.Supervisor.Stop(r.Context(), instanceID)
	case "restart":
		err = s.Supervisor.Restart(r.Context(), instanceID)
	case "config":
		var req struct {
			Config  json.RawMessage `json:"config"`
			Restart bool            `json:"restart"`
		}
		if err := readJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		inst, updateErr := s.Supervisor.UpdateConfig(r.Context(), instanceID, req.Config, req.Restart)
		if updateErr != nil {
			writeError(w, http.StatusBadRequest, updateErr.Error())
			return
		}
		writeJSON(w, http.StatusOK, newInstanceResponse(inst))
		return
	case "secret":
		var req struct {
			Secret  json.RawMessage `json:"secret"`
			Restart bool            `json:"restart"`
		}
		if err := readJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		inst, updateErr := s.Supervisor.UpdateSecret(r.Context(), instanceID, req.Secret, req.Restart)
		if updateErr != nil {
			writeError(w, http.StatusBadRequest, updateErr.Error())
			return
		}
		writeJSON(w, http.StatusOK, newInstanceResponse(inst))
		return
	default:
		writeError(w, http.StatusNotFound, "unknown instance action")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	inst, err := s.Store.GetInstance(r.Context(), instanceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, newInstanceResponse(inst))
}

func (s *Server) echoInstancePath(c *echo.Context) error {
	s.handleInstancePath(c.Response(), c.Request(), c.Param("instance_id"), "")
	return nil
}

func (s *Server) echoInstanceAction(c *echo.Context) error {
	s.handleInstancePath(c.Response(), c.Request(), c.Param("instance_id"), c.Param("action"))
	return nil
}

func (s *Server) handleCapsets(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		capsets, err := s.Store.ListCapsets(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"capsets": capsets})
	case http.MethodPost:
		var cap domain.Capset
		if err := readJSON(r, &cap); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if !cap.Enabled {
			cap.Enabled = true
		}
		if err := s.Store.CreateCapset(r.Context(), cap); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		cap, err := s.Store.GetCapset(r.Context(), cap.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		s.logger().Info("capset_created", "capset_id", cap.ID)
		writeJSON(w, http.StatusOK, cap)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) echoCapsets(c *echo.Context) error {
	s.handleCapsets(c.Response(), c.Request())
	return nil
}

func (s *Server) handleCapsetPath(w http.ResponseWriter, r *http.Request, capsetID, resource, instanceID string) {
	if capsetID != "" && resource == "" {
		switch r.Method {
		case http.MethodGet:
			cap, err := s.Store.GetCapset(r.Context(), capsetID)
			if err != nil {
				writeError(w, http.StatusNotFound, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, cap)
		case http.MethodPatch:
			var req struct {
				Name        *string `json:"name"`
				Description *string `json:"description"`
				Enabled     *bool   `json:"enabled"`
			}
			if err := readJSON(r, &req); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			cap, err := s.Store.GetCapset(r.Context(), capsetID)
			if err != nil {
				writeError(w, http.StatusNotFound, err.Error())
				return
			}
			if req.Name != nil {
				cap.Name = *req.Name
			}
			if req.Description != nil {
				cap.Description = *req.Description
			}
			if req.Enabled != nil {
				cap.Enabled = *req.Enabled
			}
			if cap.Name == "" {
				writeError(w, http.StatusBadRequest, "capset name is required")
				return
			}
			if err := s.Store.UpsertCapset(r.Context(), cap); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			updated, err := s.Store.GetCapset(r.Context(), capsetID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			s.logger().Info("capset_updated", "capset_id", updated.ID, "enabled", updated.Enabled)
			writeJSON(w, http.StatusOK, updated)
		case http.MethodDelete:
			if err := s.Store.DeleteCapset(r.Context(), capsetID); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			s.logger().Info("capset_deleted", "capset_id", capsetID)
			writeJSON(w, http.StatusOK, map[string]any{"deleted": true, "capset_id": capsetID})
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
		return
	}
	if capsetID != "" && resource == "instances" && instanceID == "" {
		if r.Method == http.MethodGet {
			items, err := s.Store.ListCapsetInstances(r.Context(), capsetID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"instances": items})
			return
		}
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		var req struct {
			InstanceID   string `json:"instance_id"`
			AllMethods   *bool  `json:"all_methods"`
			NoAllMethods bool   `json:"no_all_methods"`
		}
		if err := readJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if _, err := s.Store.GetCapset(r.Context(), capsetID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				writeError(w, http.StatusNotFound, "capset not found")
				return
			}
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		inst, err := s.Store.GetInstance(r.Context(), req.InstanceID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				writeError(w, http.StatusNotFound, "instance not found")
				return
			}
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		svc, err := s.Store.GetService(r.Context(), inst.ServiceID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				writeError(w, http.StatusNotFound, "service not found")
				return
			}
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		includeAll := !req.NoAllMethods && (req.AllMethods == nil || *req.AllMethods)
		ci := domain.CapsetInstance{ID: capsetID + ":" + req.InstanceID, CapsetID: capsetID, ServiceID: inst.ServiceID, InstanceID: req.InstanceID, IncludeAllMethods: includeAll, Enabled: true}
		if err := s.Store.AddCapsetInstance(r.Context(), ci); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		ci, err = s.Store.GetCapsetInstance(r.Context(), ci.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if includeAll {
			for _, method := range svc.Methods {
				toolName := ""
				if method.Unary {
					toolName = domain.MCPToolName(svc.ID, req.InstanceID, method.FullName)
					if exists, err := s.Store.MCPToolNameExists(r.Context(), capsetID, toolName); err != nil {
						writeError(w, http.StatusBadRequest, err.Error())
						return
					} else if exists {
						writeError(w, http.StatusBadRequest, "MCP tool name conflict; specify --mcp-tool")
						return
					}
				}
				if err := s.Store.AddCapsetMethod(r.Context(), domain.CapsetMethod{CapsetInstanceID: ci.ID, MethodFullName: method.FullName, MCPToolName: toolName, Enabled: true}); err != nil {
					writeError(w, http.StatusBadRequest, err.Error())
					return
				}
			}
		}
		s.logger().Info("capset_instance_added", "capset_id", capsetID, "instance_id", req.InstanceID, "all_methods", includeAll)
		writeJSON(w, http.StatusOK, ci)
		return
	}
	if capsetID != "" && resource == "instances" && instanceID != "" {
		if r.Method != http.MethodDelete {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		if err := s.Store.DeleteCapsetInstance(r.Context(), capsetID, instanceID); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		s.logger().Info("capset_instance_removed", "capset_id", capsetID, "instance_id", instanceID)
		writeJSON(w, http.StatusOK, map[string]any{"deleted": true, "capset_id": capsetID, "instance_id": instanceID})
		return
	}
	if capsetID != "" && resource == "methods" && instanceID == "" {
		if r.Method == http.MethodDelete {
			instanceID := r.URL.Query().Get("instance_id")
			method := r.URL.Query().Get("method")
			if instanceID == "" || method == "" {
				writeError(w, http.StatusBadRequest, "instance_id and method are required")
				return
			}
			if err := s.Store.DeleteCapsetMethod(r.Context(), capsetID, instanceID, method); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			s.logger().Info("capset_method_removed", "capset_id", capsetID, "instance_id", instanceID, "method", method)
			writeJSON(w, http.StatusOK, map[string]any{"deleted": true, "capset_id": capsetID, "instance_id": instanceID, "method": method})
			return
		}
		if r.Method == http.MethodGet {
			var methods []domain.CapsetMethod
			instances, err := s.Store.ListCapsetInstances(r.Context(), capsetID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			for _, inst := range instances {
				items, err := s.Store.ListCapsetMethods(r.Context(), inst.ID)
				if err != nil {
					writeError(w, http.StatusInternalServerError, err.Error())
					return
				}
				methods = append(methods, items...)
			}
			writeJSON(w, http.StatusOK, map[string]any{"methods": methods})
			return
		}
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		var req struct {
			InstanceID string `json:"instance_id"`
			Method     string `json:"method"`
			MCPTool    string `json:"mcp_tool"`
		}
		if err := readJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		ciID := capsetID + ":" + req.InstanceID
		method := strings.TrimPrefix(req.Method, "/")
		ci, err := s.Store.GetCapsetInstance(r.Context(), ciID)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		svc, err := s.Store.GetService(r.Context(), ci.ServiceID)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		selected, ok := findServiceMethod(svc.Methods, method)
		if !ok {
			writeError(w, http.StatusBadRequest, "method is not a service method")
			return
		}
		toolName := req.MCPTool
		if !selected.Unary {
			toolName = ""
		} else if toolName == "" {
			toolName = domain.MCPToolName(svc.ID, ci.InstanceID, selected.FullName)
		}
		if selected.Unary {
			if exists, err := s.Store.MCPToolNameExists(r.Context(), capsetID, toolName); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			} else if exists {
				writeError(w, http.StatusBadRequest, "MCP tool name conflict; specify --mcp-tool")
				return
			}
		}
		if err := s.Store.AddCapsetMethod(r.Context(), domain.CapsetMethod{CapsetInstanceID: ciID, MethodFullName: selected.FullName, MCPToolName: toolName, Enabled: true}); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		s.logger().Info("capset_method_selected", "capset_id", capsetID, "instance_id", req.InstanceID, "method", selected.FullName, "mcp_tool", toolName)
		writeJSON(w, http.StatusOK, map[string]any{"capset_instance_id": ciID, "method": selected.FullName, "mcp_tool": toolName})
		return
	}
	if capsetID != "" && resource == "tokens" && instanceID == "" {
		if r.Method == http.MethodGet {
			items, err := s.Store.ListCapsetTokens(r.Context(), capsetID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"tokens": items})
			return
		}
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		var req struct {
			ID     string `json:"id"`
			Name   string `json:"name"`
			Secret string `json:"token"`
		}
		if err := readJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if req.ID == "" || req.Secret == "" {
			writeError(w, http.StatusBadRequest, "token id and token are required")
			return
		}
		if _, err := s.Store.GetCapset(r.Context(), capsetID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				writeError(w, http.StatusNotFound, "capset not found")
				return
			}
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		token, err := s.Store.AddCapsetToken(r.Context(), domain.CapsetToken{ID: req.ID, CapsetID: capsetID, Name: req.Name}, req.Secret)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		s.logger().Info("capset_token_created", "capset_id", capsetID, "token_id", token.ID)
		writeJSON(w, http.StatusOK, token)
		return
	}
	if capsetID != "" && resource == "tokens" && instanceID != "" {
		if r.Method != http.MethodDelete {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		if err := s.Store.DeleteCapsetToken(r.Context(), capsetID, instanceID); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		s.logger().Info("capset_token_deleted", "capset_id", capsetID, "token_id", instanceID)
		writeJSON(w, http.StatusOK, map[string]any{"deleted": true, "capset_id": capsetID, "token_id": instanceID})
		return
	}
	writeError(w, http.StatusNotFound, "unknown capset route")
}

func (s *Server) logger() *slog.Logger {
	if s == nil {
		return daemonlog.Nop()
	}
	return daemonlog.OrNop(s.Logger)
}

func (s *Server) echoCapsetPath(c *echo.Context) error {
	s.handleCapsetPath(c.Response(), c.Request(), c.Param("capset_id"), "", "")
	return nil
}

func (s *Server) echoCapsetInstances(c *echo.Context) error {
	s.handleCapsetPath(c.Response(), c.Request(), c.Param("capset_id"), "instances", "")
	return nil
}

func (s *Server) echoCapsetInstance(c *echo.Context) error {
	s.handleCapsetPath(c.Response(), c.Request(), c.Param("capset_id"), "instances", c.Param("instance_id"))
	return nil
}

func (s *Server) echoCapsetMethods(c *echo.Context) error {
	s.handleCapsetPath(c.Response(), c.Request(), c.Param("capset_id"), "methods", "")
	return nil
}

func (s *Server) echoCapsetTokens(c *echo.Context) error {
	s.handleCapsetPath(c.Response(), c.Request(), c.Param("capset_id"), "tokens", "")
	return nil
}

func (s *Server) echoCapsetToken(c *echo.Context) error {
	s.handleCapsetPath(c.Response(), c.Request(), c.Param("capset_id"), "tokens", c.Param("token_id"))
	return nil
}

func findServiceMethod(methods []domain.Method, fullName string) (domain.Method, bool) {
	for _, method := range methods {
		if method.FullName == fullName || "/"+method.FullName == fullName {
			return method, true
		}
	}
	return domain.Method{}, false
}

func bearerToken(value string) string {
	scheme, token, ok := strings.Cut(strings.TrimSpace(value), " ")
	if !ok || !strings.EqualFold(scheme, "bearer") {
		return ""
	}
	return strings.TrimSpace(token)
}

func ListenAndServe(ctx context.Context, addr string, handler http.Handler) error {
	server := NewHTTPServer(addr, handler)
	go func() {
		<-ctx.Done()
		_ = server.Shutdown(context.Background())
	}()
	err := server.ListenAndServe()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func NewHTTPServer(addr string, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}
}

func echoErrorStatus(err error) int {
	var sc echo.HTTPStatusCoder
	if errors.As(err, &sc) {
		return sc.StatusCode()
	}
	return http.StatusInternalServerError
}

func readJSON(r *http.Request, out any) error {
	defer r.Body.Close()
	return decodeStrictJSON(r.Body, out)
}

func decodeStrictJSON(r io.Reader, out any) error {
	dec := json.NewDecoder(r)
	dec.DisallowUnknownFields()
	return dec.Decode(out)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"error": map[string]any{"code": fmt.Sprintf("HTTP_%d", status), "message": msg, "details": map[string]any{}}})
}

func acceptsNDJSON(r *http.Request) bool {
	for _, part := range strings.Split(r.Header.Get("Accept"), ",") {
		mediaType := strings.TrimSpace(strings.SplitN(part, ";", 2)[0])
		if mediaType == "application/x-ndjson" {
			return true
		}
	}
	return false
}

func writeNDJSONEvent(w http.ResponseWriter, event packageimport.ImportProgressEvent) error {
	if err := json.NewEncoder(w).Encode(event); err != nil {
		return err
	}
	return flushHTTP(w)
}

func flushHTTP(w http.ResponseWriter) error {
	return http.NewResponseController(w).Flush()
}
