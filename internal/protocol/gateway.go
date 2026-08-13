package protocol

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"connectrpc.com/connect"
	"github.com/labstack/echo/v5"
	"github.com/pb33f/libopenapi"
	v3 "github.com/pb33f/libopenapi/datamodel/high/v3"
	"github.com/pb33f/libopenapi/orderedmap"
	mcpgen "github.com/redpanda-data/protoc-gen-go-mcp/pkg/gen"
	"github.com/sudorandom/protoc-gen-connect-openapi/converter"
	yaml "go.yaml.in/yaml/v4"

	"octobus/internal/descriptors"
	"octobus/internal/domain"
	"octobus/internal/store"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/encoding"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
	"google.golang.org/protobuf/types/dynamicpb"
)

type Gateway struct {
	Store        *store.Store
	DataDir      string
	AccessLogger accessLogger
	Logger       *slog.Logger

	mu            sync.Mutex
	conns         map[string]*grpc.ClientConn
	mcpToolsCache map[string][]map[string]any
	connectCache  map[string]http.Handler
}

const DefaultMaxRequestBytes int64 = 1 << 20

type Catalog struct {
	CapsetID    string                  `json:"capset_id"`
	Name        string                  `json:"name"`
	Description string                  `json:"description"`
	GRPC        []GRPCCatalogItem       `json:"grpc"`
	MCP         []MCPCatalogItem        `json:"mcp"`
	ConnectRPC  []ConnectRPCCatalogItem `json:"connect_rpc"`

	includeGRPC    bool
	includeMCP     bool
	includeConnect bool
}

type CatalogOptions struct {
	IncludeGRPC    bool
	IncludeMCP     bool
	IncludeConnect bool
}

type GRPCCatalogItem struct {
	ServiceID             string            `json:"service_id"`
	RuntimeMode           string            `json:"runtime_mode"`
	InstanceID            string            `json:"instance_id"`
	MethodFullName        string            `json:"method_full_name"`
	MethodPath            string            `json:"method_path"`
	Metadata              map[string]string `json:"metadata"`
	DescriptorVersion     string            `json:"descriptor_version"`
	DescriptorSHA256      string            `json:"descriptor_sha256"`
	RequestMessageName    string            `json:"request_message_full_name"`
	ResponseMessageName   string            `json:"response_message_full_name"`
	BackendInstanceStatus string            `json:"backend_instance_status"`
}

type MCPCatalogItem struct {
	ServiceID             string `json:"service_id"`
	RuntimeMode           string `json:"runtime_mode"`
	InstanceID            string `json:"instance_id"`
	MethodFullName        string `json:"method_full_name"`
	Endpoint              string `json:"endpoint"`
	ToolName              string `json:"tool_name"`
	DescriptorVersion     string `json:"descriptor_version"`
	DescriptorSHA256      string `json:"descriptor_sha256"`
	RequestMessageName    string `json:"request_message_full_name"`
	ResponseMessageName   string `json:"response_message_full_name"`
	BackendInstanceStatus string `json:"backend_instance_status"`
}

type ConnectRPCCatalogItem struct {
	ServiceID             string   `json:"service_id"`
	RuntimeMode           string   `json:"runtime_mode"`
	InstanceID            string   `json:"instance_id"`
	MethodFullName        string   `json:"method_full_name"`
	Procedure             string   `json:"procedure"`
	Endpoint              string   `json:"endpoint"`
	OpenAPIURL            string   `json:"openapi_url"`
	HTTPMethod            string   `json:"http_method"`
	ContentTypes          []string `json:"content_types"`
	DescriptorVersion     string   `json:"descriptor_version"`
	DescriptorSHA256      string   `json:"descriptor_sha256"`
	RequestMessageName    string   `json:"request_message_full_name"`
	ResponseMessageName   string   `json:"response_message_full_name"`
	BackendInstanceStatus string   `json:"backend_instance_status"`
}

func (g *Gateway) Handler() http.Handler {
	e := echo.New()
	e.HTTPErrorHandler = func(c *echo.Context, err error) {
		writeJSON(c.Response(), echoErrorStatus(err), map[string]any{"error": "not found"})
	}
	e.Any("/capsets/:capset_id/mcp", g.echoMCP)
	e.GET("/capsets/:capset_id/openapi.json", g.echoOpenAPIJSON)
	e.GET("/capsets/:capset_id/openapi.yaml", g.echoOpenAPIYAML)
	e.Any("/capsets/:capset_id/connect/:instance_id/*", g.echoConnectRPC)
	return e
}

func (g *Gateway) Catalog(ctx context.Context, capsetID string) (Catalog, error) {
	return g.CatalogWithOptions(ctx, capsetID, CatalogOptions{IncludeGRPC: true})
}

func (g *Gateway) CatalogWithOptions(ctx context.Context, capsetID string, opts CatalogOptions) (Catalog, error) {
	if !opts.IncludeGRPC && !opts.IncludeMCP && !opts.IncludeConnect {
		opts.IncludeGRPC = true
	}
	cap, err := g.Store.GetCapset(ctx, capsetID)
	if err != nil {
		return Catalog{}, err
	}
	if !cap.Enabled {
		return Catalog{}, sql.ErrNoRows
	}
	items, err := g.Store.ListExposedMethods(ctx, capsetID)
	if err != nil {
		return Catalog{}, err
	}
	cat := Catalog{
		CapsetID:    cap.ID,
		Name:        cap.Name,
		Description: cap.Description,
		GRPC:        []GRPCCatalogItem{},
		MCP:         []MCPCatalogItem{},
		ConnectRPC:  []ConnectRPCCatalogItem{},

		includeGRPC:    opts.IncludeGRPC,
		includeMCP:     opts.IncludeMCP,
		includeConnect: opts.IncludeConnect,
	}
	for _, item := range items {
		backendStatus := catalogBackendStatus(item)
		if opts.IncludeGRPC {
			cat.GRPC = append(cat.GRPC, GRPCCatalogItem{
				ServiceID:             item.Service.ID,
				RuntimeMode:           string(item.Service.RuntimeMode),
				InstanceID:            item.Instance.ID,
				MethodFullName:        item.Method.FullName,
				MethodPath:            "/" + item.Method.FullName,
				Metadata:              item.GRPCMetadata,
				DescriptorVersion:     item.DescriptorVer,
				DescriptorSHA256:      item.DescriptorHash,
				RequestMessageName:    item.Method.InputFullName,
				ResponseMessageName:   item.Method.OutputFullName,
				BackendInstanceStatus: backendStatus,
			})
		}
		if !item.Method.Unary {
			continue
		}
		if opts.IncludeMCP {
			cat.MCP = append(cat.MCP, MCPCatalogItem{
				ServiceID:             item.Service.ID,
				RuntimeMode:           string(item.Service.RuntimeMode),
				InstanceID:            item.Instance.ID,
				MethodFullName:        item.Method.FullName,
				Endpoint:              fmt.Sprintf("/capsets/%s/mcp", item.Capset.ID),
				ToolName:              item.MCPToolName,
				DescriptorVersion:     item.DescriptorVer,
				DescriptorSHA256:      item.DescriptorHash,
				RequestMessageName:    item.Method.InputFullName,
				ResponseMessageName:   item.Method.OutputFullName,
				BackendInstanceStatus: backendStatus,
			})
		}
		if opts.IncludeConnect {
			cat.ConnectRPC = append(cat.ConnectRPC, ConnectRPCCatalogItem{
				ServiceID:             item.Service.ID,
				RuntimeMode:           string(item.Service.RuntimeMode),
				InstanceID:            item.Instance.ID,
				MethodFullName:        item.Method.FullName,
				Procedure:             "/" + item.Method.FullName,
				Endpoint:              item.ConnectPath,
				OpenAPIURL:            fmt.Sprintf("/capsets/%s/openapi.json", item.Capset.ID),
				HTTPMethod:            http.MethodPost,
				ContentTypes:          connectContentTypes(),
				DescriptorVersion:     item.DescriptorVer,
				DescriptorSHA256:      item.DescriptorHash,
				RequestMessageName:    item.Method.InputFullName,
				ResponseMessageName:   item.Method.OutputFullName,
				BackendInstanceStatus: backendStatus,
			})
		}
	}
	return cat, nil
}

func catalogBackendStatus(item store.ExposedMethod) string {
	if _, err := os.Stat(item.Service.DescriptorPath); err != nil {
		return string(domain.StatusDegraded)
	}
	return string(item.Instance.Status)
}

func RenderCatalogMarkdown(cat Catalog) []byte {
	var b strings.Builder
	title := cat.CapsetID
	if cat.Name != "" {
		title += " / " + cat.Name
	}
	fmt.Fprintf(&b, "# Catalog: %s\n\n", title)
	if cat.Description != "" {
		fmt.Fprintf(&b, "%s\n\n", cat.Description)
	}
	renderSchemaDiscoveryMarkdown(&b, cat)
	if cat.includeGRPC {
		renderGRPCMarkdown(&b, cat.GRPC)
	}
	if cat.includeMCP {
		renderMCPMarkdown(&b, cat.MCP)
	}
	if cat.includeConnect {
		renderConnectMarkdown(&b, cat.ConnectRPC)
	}
	return []byte(b.String())
}

func renderSchemaDiscoveryMarkdown(b *strings.Builder, cat Catalog) {
	lines := []string{}
	if cat.includeGRPC {
		lines = append(lines, fmt.Sprintf("- gRPC: use server reflection with `x-octobus-capset=%s` metadata; call the table `Method`.", mdEscape(cat.CapsetID)))
	}
	if cat.includeMCP {
		lines = append(lines, "- MCP: call `tools/list` on the table `Endpoint`, then call the table `Tool` name with that tool's `inputSchema`.")
	}
	if cat.includeConnect {
		lines = append(lines, "- Connect RPC: fetch the table `OpenAPI` document, then POST JSON to the table `Endpoint` path.")
	}
	if len(lines) == 0 {
		return
	}
	fmt.Fprintf(b, "## Schema Discovery\n\n")
	for _, line := range lines {
		fmt.Fprintf(b, "%s\n", line)
	}
	fmt.Fprintf(b, "\n")
}

func renderGRPCMarkdown(b *strings.Builder, items []GRPCCatalogItem) {
	if items == nil {
		return
	}
	fmt.Fprintf(b, "## gRPC\n\n")
	if len(items) == 0 {
		fmt.Fprintf(b, "No entries.\n\n")
		return
	}
	fmt.Fprintf(b, "| Method | Metadata | Request | Response |\n")
	fmt.Fprintf(b, "| --- | --- | --- | --- |\n")
	for _, item := range items {
		fmt.Fprintf(b, "| `%s` | `%s` | `%s` | `%s` |\n",
			mdEscape(item.MethodPath), mdEscape(metadataSummary(item.Metadata)), mdEscape(item.RequestMessageName), mdEscape(item.ResponseMessageName))
	}
	fmt.Fprintf(b, "\n")
}

func renderMCPMarkdown(b *strings.Builder, items []MCPCatalogItem) {
	if items == nil {
		return
	}
	fmt.Fprintf(b, "## MCP\n\n")
	if len(items) == 0 {
		fmt.Fprintf(b, "No entries.\n\n")
		return
	}
	fmt.Fprintf(b, "| Endpoint | Tool | Method | Request | Response |\n")
	fmt.Fprintf(b, "| --- | --- | --- | --- | --- |\n")
	for _, item := range items {
		fmt.Fprintf(b, "| `%s` | `%s` | `%s` | `%s` | `%s` |\n",
			mdEscape(item.Endpoint), mdEscape(item.ToolName), mdEscape(item.MethodFullName), mdEscape(item.RequestMessageName), mdEscape(item.ResponseMessageName))
	}
	fmt.Fprintf(b, "\n")
}

func renderConnectMarkdown(b *strings.Builder, items []ConnectRPCCatalogItem) {
	if items == nil {
		return
	}
	fmt.Fprintf(b, "## Connect RPC\n\n")
	if len(items) == 0 {
		fmt.Fprintf(b, "No entries.\n\n")
		return
	}
	fmt.Fprintf(b, "| Endpoint | OpenAPI | Procedure | Request | Response |\n")
	fmt.Fprintf(b, "| --- | --- | --- | --- | --- |\n")
	for _, item := range items {
		fmt.Fprintf(b, "| `%s` | `%s` | `%s` | `%s` | `%s` |\n",
			mdEscape(item.Endpoint), mdEscape(item.OpenAPIURL), mdEscape(item.Procedure), mdEscape(item.RequestMessageName), mdEscape(item.ResponseMessageName))
	}
	fmt.Fprintf(b, "\n")
}

func mdEscape(s string) string {
	s = strings.ReplaceAll(s, "|", "\\|")
	s = strings.ReplaceAll(s, "\n", " ")
	return s
}

func metadataSummary(md map[string]string) string {
	keys := make([]string, 0, len(md))
	for key := range md {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, key+"="+md[key])
	}
	return strings.Join(parts, ", ")
}

func connectContentTypes() []string {
	return []string{"application/json", "application/proto", "application/connect+json", "application/connect+proto"}
}

func (g *Gateway) OpenAPI(ctx context.Context, capsetID string, format string) ([]byte, error) {
	if format != "json" && format != "yaml" {
		return nil, fmt.Errorf("unsupported OpenAPI format %q", format)
	}
	cat, err := g.CatalogWithOptions(ctx, capsetID, CatalogOptions{IncludeConnect: true})
	if err != nil {
		return nil, err
	}
	if len(cat.ConnectRPC) == 0 {
		return emptyOpenAPI(cat, format)
	}
	items, err := g.Store.ListExposedMethods(ctx, capsetID)
	if err != nil {
		return nil, err
	}
	base := fmt.Sprintf(`{"openapi":"3.1.0","info":{"title":"OctoBus Connect RPC Catalog: %s","version":"%s"},"paths":{}}`, cat.CapsetID, cat.CapsetID)
	byDescriptor := map[string][]store.ExposedMethod{}
	for _, item := range items {
		if !item.Method.Unary {
			continue
		}
		byDescriptor[item.Service.DescriptorPath] = append(byDescriptor[item.Service.DescriptorPath], item)
	}
	var docs []*v3.Document
	for _, descriptorItems := range byDescriptor {
		files, err := filesForDescriptor(descriptorItems[0].Service.DescriptorPath)
		if err != nil {
			return nil, err
		}
		services := uniqueServiceNames(descriptorItems)
		raw, err := converter.GenerateSingle(
			converter.WithFiles(files),
			converter.WithFormat("json"),
			converter.WithBaseOpenAPI([]byte(base)),
			converter.WithServices(services),
			converter.WithContentTypes("json", "proto", "connect+json", "connect+proto"),
			converter.WithTrimUnusedTypes(true),
			converter.WithIgnoreGoogleapiHTTP(true),
		)
		if err != nil {
			return nil, err
		}
		doc, err := rewriteOpenAPI(raw, descriptorItems)
		if err != nil {
			return nil, err
		}
		docs = append(docs, doc)
	}
	merged, err := mergeOpenAPIDocuments(cat, docs)
	if err != nil {
		return nil, err
	}
	if format == "json" {
		return merged.RenderJSON("  ")
	}
	return merged.Render()
}

func emptyOpenAPI(cat Catalog, format string) ([]byte, error) {
	doc := map[string]any{
		"openapi": "3.1.0",
		"info": map[string]any{
			"title":   "OctoBus Connect RPC Catalog: " + cat.CapsetID,
			"version": cat.CapsetID,
		},
		"paths": map[string]any{},
	}
	if format == "json" {
		return json.MarshalIndent(doc, "", "  ")
	}
	return yaml.Marshal(doc)
}

func filesForDescriptor(path string) (*protoregistry.Files, error) {
	set, err := descriptors.Load(path)
	if err != nil {
		return nil, fmt.Errorf("descriptor load failed: %w", err)
	}
	files, err := protodesc.NewFiles(set)
	if err != nil {
		return nil, fmt.Errorf("descriptor load failed: %w", err)
	}
	return files, nil
}

func uniqueServiceNames(items []store.ExposedMethod) []protoreflect.FullName {
	seen := map[protoreflect.FullName]bool{}
	var out []protoreflect.FullName
	for _, item := range items {
		name := protoreflect.FullName(item.Method.ServiceFullName)
		if seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, name)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

func rewriteOpenAPI(raw []byte, items []store.ExposedMethod) (*v3.Document, error) {
	doc, err := openAPIModel(raw)
	if err != nil {
		return nil, err
	}
	newPaths := orderedmap.New[string, *v3.PathItem]()
	for _, item := range items {
		sourcePath := "/" + item.Method.FullName
		pathItem, ok := doc.Paths.PathItems.Get(sourcePath)
		if !ok {
			return nil, fmt.Errorf("generated OpenAPI missing path %s", sourcePath)
		}
		cloned, err := clonePathItem(pathItem, doc.Components)
		if err != nil {
			return nil, err
		}
		setOperationIDs(cloned, item)
		makeConnectProtocolVersionOptional(cloned)
		newPaths.Set(item.ConnectPath, cloned)
	}
	doc.Paths.PathItems = newPaths
	return doc, nil
}

func openAPIModel(raw []byte) (*v3.Document, error) {
	lowDoc, err := libopenapi.NewDocument(raw)
	if err != nil {
		return nil, err
	}
	model, err := lowDoc.BuildV3Model()
	if err != nil {
		return nil, err
	}
	return &model.Model, nil
}

func clonePathItem(item *v3.PathItem, components *v3.Components) (*v3.PathItem, error) {
	raw, err := item.Render()
	if err != nil {
		return nil, err
	}
	wrapped := append([]byte("openapi: 3.1.0\ninfo:\n  title: clone\n  version: clone\npaths:\n  /clone:\n"), indentYAML(raw, 4)...)
	if components != nil {
		componentsRaw, err := components.Render()
		if err != nil {
			return nil, err
		}
		wrapped = append(wrapped, []byte("components:\n")...)
		wrapped = append(wrapped, indentYAML(componentsRaw, 2)...)
	}
	doc, err := openAPIModel(wrapped)
	if err != nil {
		return nil, err
	}
	cloned, ok := doc.Paths.PathItems.Get("/clone")
	if !ok {
		return nil, errors.New("failed to clone OpenAPI path item")
	}
	return cloned, nil
}

func indentYAML(raw []byte, spaces int) []byte {
	prefix := strings.Repeat(" ", spaces)
	lines := strings.Split(strings.TrimRight(string(raw), "\n"), "\n")
	for i, line := range lines {
		lines[i] = prefix + line
	}
	return []byte(strings.Join(lines, "\n") + "\n")
}

func setOperationIDs(pathItem *v3.PathItem, item store.ExposedMethod) {
	for pair := pathItem.GetOperations().First(); pair != nil; pair = pair.Next() {
		pair.Value().OperationId = openAPIOperationID(item, pair.Key())
	}
}

func makeConnectProtocolVersionOptional(pathItem *v3.PathItem) {
	for _, param := range pathItem.Parameters {
		makeConnectProtocolVersionParameterOptional(param)
	}
	for pair := pathItem.GetOperations().First(); pair != nil; pair = pair.Next() {
		for _, param := range pair.Value().Parameters {
			makeConnectProtocolVersionParameterOptional(param)
		}
	}
}

func makeConnectProtocolVersionParameterOptional(param *v3.Parameter) {
	if param == nil || param.Reference != "" {
		return
	}
	if !strings.EqualFold(param.In, "header") || !strings.EqualFold(param.Name, "Connect-Protocol-Version") {
		return
	}
	required := false
	param.Required = &required
}

func openAPIOperationID(item store.ExposedMethod, method string) string {
	raw := strings.Join([]string{item.Capset.ID, item.Service.ID, item.Instance.ID, item.Method.FullName, method}, "_")
	var b strings.Builder
	for _, r := range raw {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
	}
	return b.String()
}

func mergeOpenAPIDocuments(cat Catalog, docs []*v3.Document) (*v3.Document, error) {
	raw, err := emptyOpenAPI(cat, "json")
	if err != nil {
		return nil, err
	}
	merged, err := openAPIModel(raw)
	if err != nil {
		return nil, err
	}
	for _, doc := range docs {
		if doc.Paths != nil && doc.Paths.PathItems != nil {
			for pair := doc.Paths.PathItems.First(); pair != nil; pair = pair.Next() {
				merged.Paths.PathItems.Set(pair.Key(), pair.Value())
			}
		}
		if doc.Components != nil {
			if merged.Components == nil {
				merged.Components = doc.Components
			} else if err := mergeComponents(merged.Components, doc.Components); err != nil {
				return nil, err
			}
		}
	}
	return merged, nil
}

func mergeComponents(dst, src *v3.Components) error {
	dstRaw, err := dst.Render()
	if err != nil {
		return err
	}
	srcRaw, err := src.Render()
	if err != nil {
		return err
	}
	var dstMap map[string]any
	var srcMap map[string]any
	if err := yaml.Unmarshal(dstRaw, &dstMap); err != nil {
		return err
	}
	if err := yaml.Unmarshal(srcRaw, &srcMap); err != nil {
		return err
	}
	merged, err := mergeComponentMaps(dstMap, srcMap)
	if err != nil {
		return err
	}
	raw, err := yaml.Marshal(map[string]any{"openapi": "3.1.0", "info": map[string]any{"title": "components", "version": "components"}, "paths": map[string]any{}, "components": merged})
	if err != nil {
		return err
	}
	doc, err := openAPIModel(raw)
	if err != nil {
		return err
	}
	dst.Schemas = doc.Components.Schemas
	dst.Responses = doc.Components.Responses
	dst.Parameters = doc.Components.Parameters
	dst.Examples = doc.Components.Examples
	dst.RequestBodies = doc.Components.RequestBodies
	dst.Headers = doc.Components.Headers
	dst.SecuritySchemes = doc.Components.SecuritySchemes
	dst.Links = doc.Components.Links
	dst.Callbacks = doc.Components.Callbacks
	dst.PathItems = doc.Components.PathItems
	return nil
}

func mergeComponentMaps(dst, src map[string]any) (map[string]any, error) {
	out := cloneAny(dst).(map[string]any)
	for section, rawSrc := range src {
		srcSection, ok := rawSrc.(map[string]any)
		if !ok {
			out[section] = rawSrc
			continue
		}
		dstSection, _ := out[section].(map[string]any)
		if dstSection == nil {
			out[section] = rawSrc
			continue
		}
		for name, srcValue := range srcSection {
			if dstValue, exists := dstSection[name]; exists {
				dstJSON, _ := json.Marshal(dstValue)
				srcJSON, _ := json.Marshal(srcValue)
				if !bytes.Equal(dstJSON, srcJSON) {
					return nil, fmt.Errorf("incompatible OpenAPI component %s.%s", section, name)
				}
				continue
			}
			dstSection[name] = srcValue
		}
	}
	return out, nil
}

func (g *Gateway) HandleConnectRPC(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	recorder := newStatusRecorder(w)
	route, ok := connectRouteParamsFromContext(r.Context())
	if !ok {
		var parsed bool
		route, parsed = parseConnectPath(r.URL.Path)
		if !parsed {
			record := g.newHTTPAccessRecord(r, "connect", "")
			record.GRPCCode = codes.NotFound.String()
			connect.NewErrorWriter().Write(recorder, r, connect.NewError(connect.CodeNotFound, errors.New("unknown Connect route")))
			g.finishHTTPAccessLog(start, record, recorder.Status())
			return
		}
	}
	record := g.newHTTPAccessRecord(r, "connect", route.CapsetID)
	record.Instance = route.InstanceID
	record.Method = route.MethodFullName
	defer func() {
		g.finishHTTPAccessLog(start, record, recorder.Status())
	}()
	if route.CapsetID == "" || route.InstanceID == "" || route.MethodFullName == "" {
		record.GRPCCode = codes.NotFound.String()
		connect.NewErrorWriter().Write(recorder, r, connect.NewError(connect.CodeNotFound, errors.New("unknown Connect route")))
		return
	}
	if err := g.authorizeHTTP(r, route.CapsetID); err != nil {
		record.GRPCCode = codes.Unauthenticated.String()
		connect.NewErrorWriter().Write(recorder, r, connect.NewError(connect.CodeUnauthenticated, err))
		return
	}
	item, err := g.findConnectExposedMethod(r.Context(), route)
	if err != nil {
		record.GRPCCode = connectLookupErrorCode(err).String()
		writeConnectLookupError(recorder, r, err)
		return
	}
	record.Service = item.Service.ID
	handler, err := g.connectHandler(item)
	if err != nil {
		record.GRPCCode = codes.Internal.String()
		connect.NewErrorWriter().Write(recorder, r, connect.NewError(connect.CodeInternal, err))
		return
	}
	ctx := metadata.NewIncomingContext(r.Context(), connectForwardMetadata(r.Header))
	ctx = context.WithValue(ctx, connectExposedMethodKey{}, item)
	r = r.WithContext(ctx)
	r.URL.Path = "/" + item.Method.FullName
	handler.ServeHTTP(recorder, r)
}

func (g *Gateway) echoConnectRPC(c *echo.Context) error {
	route := connectRouteParams{
		CapsetID:       c.Param("capset_id"),
		InstanceID:     c.Param("instance_id"),
		MethodFullName: c.Param("*"),
	}
	req := c.Request().WithContext(context.WithValue(c.Request().Context(), connectRouteParamsKey{}, route))
	g.HandleConnectRPC(c.Response(), req)
	return nil
}

func (g *Gateway) HandleMCP(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	recorder := newStatusRecorder(w)
	capsetID := routeParam(r.Context(), "capset_id")
	if capsetID == "" {
		capsetID = strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/capsets/"), "/mcp")
	}
	record := g.newHTTPAccessRecord(r, "mcp", capsetID)
	defer func() {
		g.finishHTTPAccessLog(start, record, recorder.Status())
	}()
	if r.Method != http.MethodPost {
		record.GRPCCode = codes.Unimplemented.String()
		writeJSON(recorder, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
		return
	}
	if requestBodyTooLarge(r) {
		record.GRPCCode = codes.ResourceExhausted.String()
		writeJSON(recorder, http.StatusRequestEntityTooLarge, mcpProtocolError(nil, "request body too large"))
		return
	}
	if err := g.authorizeHTTP(r, capsetID); err != nil {
		record.GRPCCode = codes.Unauthenticated.String()
		writeJSON(recorder, http.StatusUnauthorized, mcpProtocolError(nil, err.Error()))
		return
	}
	r.Body = http.MaxBytesReader(recorder, r.Body, DefaultMaxRequestBytes)
	var req struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      any             `json:"id"`
		Method  string          `json:"method"`
		Params  json.RawMessage `json:"params"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		if isRequestTooLarge(err) {
			record.GRPCCode = codes.ResourceExhausted.String()
			writeJSON(recorder, http.StatusRequestEntityTooLarge, mcpProtocolError(nil, "request body too large"))
			return
		}
		record.GRPCCode = codes.InvalidArgument.String()
		writeJSON(recorder, http.StatusBadRequest, mcpProtocolError(nil, "invalid JSON"))
		return
	}
	record.Method = req.Method
	switch req.Method {
	case "initialize":
		protocolVersion := negotiatedMCPProtocolVersion(req.Params)
		writeJSON(recorder, http.StatusOK, map[string]any{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"result": map[string]any{
				"protocolVersion": protocolVersion,
				"serverInfo": map[string]any{
					"name":    "octobus",
					"version": "0.0.0",
				},
				"capabilities": map[string]any{
					"tools": map[string]any{},
				},
			},
		})
	case "notifications/initialized":
		recorder.WriteHeader(http.StatusAccepted)
	case "ping":
		writeJSON(recorder, http.StatusOK, map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": map[string]any{}})
	case "resources/list":
		writeJSON(recorder, http.StatusOK, map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": map[string]any{"resources": []any{}}})
	case "resources/templates/list":
		writeJSON(recorder, http.StatusOK, map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": map[string]any{"resourceTemplates": []any{}}})
	case "prompts/list":
		writeJSON(recorder, http.StatusOK, map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": map[string]any{"prompts": []any{}}})
	case "tools/list":
		tools, err := g.mcpTools(r.Context(), capsetID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				record.GRPCCode = codes.NotFound.String()
				writeJSON(recorder, http.StatusOK, mcpToolError(req.ID, codes.NotFound, "capset not found"))
				return
			}
			record.GRPCCode = codes.Internal.String()
			writeJSON(recorder, http.StatusOK, mcpToolError(req.ID, codes.Internal, err.Error()))
			return
		}
		writeJSON(recorder, http.StatusOK, map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": map[string]any{"tools": tools}})
	case "tools/call":
		var params struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil {
			record.GRPCCode = codes.InvalidArgument.String()
			writeJSON(recorder, http.StatusOK, mcpToolError(req.ID, codes.InvalidArgument, "invalid tools/call params"))
			return
		}
		record.Tool = params.Name
		item, err := g.Store.FindTool(r.Context(), capsetID, params.Name)
		if err != nil {
			if errors.Is(err, domain.ErrMethodNotUnary) {
				record.GRPCCode = codes.Unimplemented.String()
				writeJSON(recorder, http.StatusOK, mcpToolError(req.ID, codes.Unimplemented, "method is not a unary service method"))
				return
			}
			record.GRPCCode = codes.NotFound.String()
			writeJSON(recorder, http.StatusOK, mcpToolError(req.ID, codes.NotFound, "tool not found"))
			return
		}
		record.Service = item.Service.ID
		record.Instance = item.Instance.ID
		record.Method = item.Method.FullName
		resp, err := g.invokeJSON(r.Context(), item, bytes.NewReader(params.Arguments))
		if err != nil {
			st, _ := status.FromError(err)
			record.GRPCCode = st.Code().String()
			writeJSON(recorder, http.StatusOK, mcpToolError(req.ID, st.Code(), st.Message()))
			return
		}
		var structured any
		_ = json.Unmarshal(resp, &structured)
		writeJSON(recorder, http.StatusOK, map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": map[string]any{"structuredContent": structured, "content": []map[string]any{{"type": "text", "text": string(resp)}}}})
	default:
		if strings.HasPrefix(req.Method, "notifications/") {
			recorder.WriteHeader(http.StatusAccepted)
			return
		}
		record.GRPCCode = codes.Unimplemented.String()
		writeJSON(recorder, http.StatusOK, mcpProtocolError(req.ID, "unsupported MCP method"))
	}
}

func negotiatedMCPProtocolVersion(params json.RawMessage) string {
	const latestSupported = "2025-11-25"
	var initParams struct {
		ProtocolVersion string `json:"protocolVersion"`
	}
	if err := json.Unmarshal(params, &initParams); err != nil {
		return latestSupported
	}
	switch initParams.ProtocolVersion {
	case "2025-11-25", "2025-06-18", "2025-03-26":
		return initParams.ProtocolVersion
	default:
		return latestSupported
	}
}

func (g *Gateway) mcpTools(ctx context.Context, capsetID string) ([]map[string]any, error) {
	items, err := g.Store.ListExposedMethods(ctx, capsetID)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, sql.ErrNoRows
	}
	cacheKey := mcpToolsCacheKey(capsetID, items)
	g.mu.Lock()
	if cached := g.mcpToolsCache[cacheKey]; cached != nil {
		g.mu.Unlock()
		return cloneToolList(cached), nil
	}
	g.mu.Unlock()

	filesByPath := map[string]*protoregistry.Files{}
	tools := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if !item.Method.Unary {
			continue
		}
		files := filesByPath[item.Service.DescriptorPath]
		if files == nil {
			set, err := descriptors.Load(item.Service.DescriptorPath)
			if err != nil {
				return nil, fmt.Errorf("descriptor load failed: %w", err)
			}
			files, err = protodesc.NewFiles(set)
			if err != nil {
				return nil, fmt.Errorf("descriptor load failed: %w", err)
			}
			filesByPath[item.Service.DescriptorPath] = files
		}
		reqDesc, err := findMessage(files, item.Method.InputFullName)
		if err != nil {
			return nil, err
		}
		methodDesc, err := findMethod(files, item.Method.FullName)
		if err != nil {
			return nil, err
		}
		inputSchema := mcpgen.MessageSchema(reqDesc, mcpgen.SchemaOptions{OpenAICompat: false})
		inputSchema["type"] = "object"
		annotateMCPSchemaWithProtoComments(inputSchema, reqDesc)
		tools = append(tools, map[string]any{
			"name":        item.MCPToolName,
			"description": mcpToolDescription(item, methodDesc),
			"inputSchema": inputSchema,
		})
	}
	g.mu.Lock()
	if g.mcpToolsCache == nil {
		g.mcpToolsCache = map[string][]map[string]any{}
	}
	g.mcpToolsCache[cacheKey] = cloneToolList(tools)
	g.mu.Unlock()
	return cloneToolList(tools), nil
}

func mcpToolsCacheKey(capsetID string, items []store.ExposedMethod) string {
	var b strings.Builder
	b.WriteString(capsetID)
	for _, item := range items {
		if !item.Method.Unary {
			continue
		}
		b.WriteByte('\n')
		b.WriteString(item.CapsetInstance.ID)
		b.WriteByte('|')
		b.WriteString(item.CapsetMethod.ID)
		b.WriteByte('|')
		b.WriteString(item.Service.DescriptorSHA256)
		b.WriteByte('|')
		b.WriteString(item.Service.DescriptorVersion)
		b.WriteByte('|')
		b.WriteString(item.Method.FullName)
		b.WriteByte('|')
		b.WriteString(item.Method.InputFullName)
		b.WriteByte('|')
		b.WriteString(item.MCPToolName)
	}
	return b.String()
}

func mcpToolDescription(item store.ExposedMethod, method protoreflect.MethodDescriptor) string {
	if method != nil {
		if comment := protoComment(method); comment != "" {
			return comment
		}
	}
	return item.Method.FullName
}

func findMethod(files *protoregistry.Files, fullName string) (protoreflect.MethodDescriptor, error) {
	serviceName, methodName, ok := strings.Cut(fullName, "/")
	if !ok || serviceName == "" || methodName == "" {
		return nil, fmt.Errorf("invalid method full name %q", fullName)
	}
	desc, err := files.FindDescriptorByName(protoreflect.FullName(serviceName))
	if err != nil {
		return nil, err
	}
	serviceDesc, ok := desc.(protoreflect.ServiceDescriptor)
	if !ok {
		return nil, fmt.Errorf("%s is not a service", serviceName)
	}
	methodDesc := serviceDesc.Methods().ByName(protoreflect.Name(methodName))
	if methodDesc == nil {
		return nil, fmt.Errorf("method %s not found", fullName)
	}
	return methodDesc, nil
}

func annotateMCPSchemaWithProtoComments(schema map[string]any, msg protoreflect.MessageDescriptor) {
	if msg == nil {
		return
	}
	mergeMCPSchemaDescription(schema, protoComment(msg))
	props, ok := schema["properties"].(map[string]any)
	if !ok {
		return
	}
	fields := msg.Fields()
	for i := 0; i < fields.Len(); i++ {
		field := fields.Get(i)
		rawProp, ok := props[string(field.Name())]
		if !ok {
			continue
		}
		prop, ok := rawProp.(map[string]any)
		if !ok {
			continue
		}
		annotateMCPFieldSchema(prop, field)
	}
	if anyOf, ok := schema["anyOf"].([]map[string]any); ok {
		annotateMCPAnyOfWithProtoComments(anyOf, msg)
	}
}

func annotateMCPFieldSchema(schema map[string]any, field protoreflect.FieldDescriptor) {
	if field.IsMap() {
		if nested, ok := schema["additionalProperties"].(map[string]any); ok && field.MapValue().Kind() == protoreflect.MessageKind {
			annotateMCPSchemaWithProtoComments(nested, field.MapValue().Message())
		}
		mergeMCPSchemaDescription(schema, protoComment(field))
		return
	}
	if field.IsList() {
		if nested, ok := schema["items"].(map[string]any); ok && field.Kind() == protoreflect.MessageKind {
			annotateMCPSchemaWithProtoComments(nested, field.Message())
		}
		mergeMCPSchemaDescription(schema, protoComment(field))
		return
	}
	if field.Kind() == protoreflect.MessageKind {
		annotateMCPSchemaWithProtoComments(schema, field.Message())
	}
	if anyOf, ok := schema["anyOf"].([]map[string]any); ok {
		annotateMCPAnyOfWithProtoComments(anyOf, field.Message())
	}
	mergeMCPSchemaDescription(schema, protoComment(field))
}

func annotateMCPAnyOfWithProtoComments(anyOf []map[string]any, msg protoreflect.MessageDescriptor) {
	if msg == nil {
		return
	}
	for _, group := range anyOf {
		oneOf, ok := group["oneOf"].([]map[string]any)
		if !ok {
			continue
		}
		for _, branch := range oneOf {
			props, ok := branch["properties"].(map[string]any)
			if !ok {
				continue
			}
			for name, rawProp := range props {
				field := msg.Fields().ByName(protoreflect.Name(name))
				if field == nil {
					continue
				}
				prop, ok := rawProp.(map[string]any)
				if !ok {
					continue
				}
				annotateMCPFieldSchema(prop, field)
			}
		}
	}
}

func mergeMCPSchemaDescription(schema map[string]any, comment string) {
	comment = strings.TrimSpace(comment)
	if comment == "" {
		return
	}
	if existing, ok := schema["description"].(string); ok && strings.TrimSpace(existing) != "" {
		schema["description"] = comment + "\n\n" + strings.TrimSpace(existing)
		return
	}
	schema["description"] = comment
}

func protoComment(desc protoreflect.Descriptor) string {
	if desc == nil || desc.ParentFile() == nil {
		return ""
	}
	loc := desc.ParentFile().SourceLocations().ByDescriptor(desc)
	return formatProtoComment(loc)
}

func formatProtoComment(loc protoreflect.SourceLocation) string {
	var parts []string
	if leading := strings.TrimSpace(loc.LeadingComments); leading != "" {
		parts = append(parts, leading)
	}
	if trailing := strings.TrimSpace(loc.TrailingComments); trailing != "" {
		parts = append(parts, trailing)
	}
	return strings.TrimSpace(strings.Join(parts, "\n\n"))
}

func cloneToolList(in []map[string]any) []map[string]any {
	out := make([]map[string]any, len(in))
	for i, tool := range in {
		out[i] = cloneMap(tool)
	}
	return out
}

func cloneMap(in map[string]any) map[string]any {
	out := make(map[string]any, len(in))
	for k, v := range in {
		out[k] = cloneAny(v)
	}
	return out
}

func cloneAny(v any) any {
	switch x := v.(type) {
	case map[string]any:
		return cloneMap(x)
	case []any:
		out := make([]any, len(x))
		for i, item := range x {
			out[i] = cloneAny(item)
		}
		return out
	default:
		return x
	}
}

func (g *Gateway) echoMCP(c *echo.Context) error {
	req := c.Request().WithContext(context.WithValue(c.Request().Context(), routeParamsKey{}, map[string]string{
		"capset_id": c.Param("capset_id"),
	}))
	g.HandleMCP(c.Response(), req)
	return nil
}

func (g *Gateway) echoOpenAPIJSON(c *echo.Context) error {
	g.handleOpenAPI(c.Response(), c.Request(), c.Param("capset_id"), "json")
	return nil
}

func (g *Gateway) echoOpenAPIYAML(c *echo.Context) error {
	g.handleOpenAPI(c.Response(), c.Request(), c.Param("capset_id"), "yaml")
	return nil
}

func (g *Gateway) handleOpenAPI(w http.ResponseWriter, r *http.Request, capsetID, format string) {
	start := time.Now()
	recorder := newStatusRecorder(w)
	record := g.newHTTPAccessRecord(r, "openapi", capsetID)
	defer func() {
		g.finishHTTPAccessLog(start, record, recorder.Status())
	}()
	if err := g.authorizeHTTP(r, capsetID); err != nil {
		record.GRPCCode = codes.Unauthenticated.String()
		writeJSON(recorder, http.StatusUnauthorized, map[string]any{"error": err.Error()})
		return
	}
	raw, err := g.OpenAPI(r.Context(), capsetID, format)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			record.GRPCCode = codes.NotFound.String()
			writeJSON(recorder, http.StatusNotFound, map[string]any{"error": err.Error()})
			return
		}
		record.GRPCCode = codes.Internal.String()
		writeJSON(recorder, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if format == "json" {
		recorder.Header().Set("Content-Type", "application/json")
	} else {
		recorder.Header().Set("Content-Type", "application/yaml")
	}
	recorder.WriteHeader(http.StatusOK)
	_, _ = recorder.Write(raw)
}

func (g *Gateway) UnaryProxy(ctx context.Context, method string, req []byte) ([]byte, error) {
	item, err := g.findGRPCExposedMethod(ctx, method)
	if err != nil {
		return nil, err
	}
	if !item.Method.Unary {
		return nil, status.Error(codes.Unimplemented, "method is not a unary service method")
	}
	return g.invokeRaw(ctx, item, req)
}

func (g *Gateway) findGRPCExposedMethod(ctx context.Context, method string) (store.ExposedMethod, error) {
	md, _ := metadata.FromIncomingContext(ctx)
	capsetID := firstMD(md, "x-octobus-capset")
	instanceID := firstMD(md, "x-octobus-instance")
	if capsetID == "" || instanceID == "" {
		return store.ExposedMethod{}, status.Error(codes.InvalidArgument, "x-octobus-capset and x-octobus-instance metadata are required")
	}
	if err := g.authorizeMetadata(ctx, capsetID); err != nil {
		return store.ExposedMethod{}, err
	}
	item, err := g.Store.FindExposedMethodByInstance(ctx, capsetID, instanceID, strings.TrimPrefix(method, "/"))
	if err != nil {
		if errors.Is(err, domain.ErrMethodNotUnary) {
			return store.ExposedMethod{}, status.Error(codes.Unimplemented, "method is not a unary service method")
		}
		return store.ExposedMethod{}, status.Error(codes.NotFound, "method is not exposed by capset")
	}
	return item, nil
}

type routeParamsKey struct{}

func routeParam(ctx context.Context, name string) string {
	params, _ := ctx.Value(routeParamsKey{}).(map[string]string)
	return params[name]
}

type connectRouteParamsKey struct{}

type connectRouteParams struct {
	CapsetID       string
	InstanceID     string
	MethodFullName string
}

func connectRouteParamsFromContext(ctx context.Context) (connectRouteParams, bool) {
	route, ok := ctx.Value(connectRouteParamsKey{}).(connectRouteParams)
	return route, ok
}

func parseConnectPath(path string) (connectRouteParams, bool) {
	parts := strings.Split(strings.TrimPrefix(path, "/capsets/"), "/")
	if len(parts) < 4 || parts[1] != "connect" {
		return connectRouteParams{}, false
	}
	return connectRouteParams{
		CapsetID:       parts[0],
		InstanceID:     parts[2],
		MethodFullName: strings.Join(parts[3:], "/"),
	}, true
}

func (g *Gateway) findConnectExposedMethod(ctx context.Context, route connectRouteParams) (store.ExposedMethod, error) {
	item, err := g.Store.FindExposedMethodByInstance(ctx, route.CapsetID, route.InstanceID, route.MethodFullName)
	if err != nil {
		return store.ExposedMethod{}, err
	}
	if !item.Method.Unary {
		return store.ExposedMethod{}, domain.ErrMethodNotUnary
	}
	return item, nil
}

type connectExposedMethodKey struct{}

func (g *Gateway) connectHandler(item store.ExposedMethod) (http.Handler, error) {
	key := connectHandlerCacheKey(item)
	g.mu.Lock()
	if g.connectCache != nil {
		if handler := g.connectCache[key]; handler != nil {
			g.mu.Unlock()
			return handler, nil
		}
	}
	g.mu.Unlock()

	files, methodDesc, err := g.methodDescriptor(item)
	if err != nil {
		return nil, err
	}
	_ = files
	handler := connect.NewUnaryHandler(
		"/"+item.Method.FullName,
		func(ctx context.Context, req *connect.Request[dynamicpb.Message]) (*connect.Response[dynamicpb.Message], error) {
			current, ok := ctx.Value(connectExposedMethodKey{}).(store.ExposedMethod)
			if !ok {
				current = item
			}
			raw, err := g.invokeRaw(ctx, current, mustMarshal(req.Msg))
			if err != nil {
				return nil, grpcStatusToConnectError(err)
			}
			resp := dynamicpb.NewMessage(methodDesc.Output())
			if err := proto.Unmarshal(raw, resp); err != nil {
				return nil, connect.NewError(connect.CodeInternal, err)
			}
			return connect.NewResponse(resp), nil
		},
		connect.WithSchema(methodDesc),
		connect.WithCodec(strictProtoJSONCodec{name: "json"}),
		connect.WithCodec(strictProtoJSONCodec{name: "json; charset=utf-8"}),
		connect.WithReadMaxBytes(int(DefaultMaxRequestBytes)),
		connect.WithRequestInitializer(func(_ connect.Spec, msg any) error {
			dynamic, ok := msg.(*dynamicpb.Message)
			if !ok {
				return fmt.Errorf("unexpected request message type %T", msg)
			}
			*dynamic = *dynamicpb.NewMessage(methodDesc.Input())
			return nil
		}),
	)
	g.mu.Lock()
	if g.connectCache == nil {
		g.connectCache = map[string]http.Handler{}
	}
	g.connectCache[key] = handler
	g.mu.Unlock()
	return handler, nil
}

func (g *Gateway) methodDescriptor(item store.ExposedMethod) (*protoregistry.Files, protoreflect.MethodDescriptor, error) {
	set, err := descriptors.Load(item.Service.DescriptorPath)
	if err != nil {
		return nil, nil, fmt.Errorf("descriptor load failed: %w", err)
	}
	files, err := protodesc.NewFiles(set)
	if err != nil {
		return nil, nil, fmt.Errorf("descriptor load failed: %w", err)
	}
	serviceName, methodName, ok := strings.Cut(item.Method.FullName, "/")
	if !ok || serviceName == "" || methodName == "" {
		return nil, nil, fmt.Errorf("invalid method full name %q", item.Method.FullName)
	}
	desc, err := files.FindDescriptorByName(protoreflect.FullName(serviceName))
	if err != nil {
		return nil, nil, err
	}
	serviceDesc, ok := desc.(protoreflect.ServiceDescriptor)
	if !ok {
		return nil, nil, fmt.Errorf("%s is not a service", serviceName)
	}
	methodDesc := serviceDesc.Methods().ByName(protoreflect.Name(methodName))
	if methodDesc == nil {
		return nil, nil, fmt.Errorf("method %s not found", item.Method.FullName)
	}
	return files, methodDesc, nil
}

func connectHandlerCacheKey(item store.ExposedMethod) string {
	return strings.Join([]string{
		item.Capset.ID,
		item.Service.ID,
		item.Instance.ID,
		item.Method.FullName,
		item.DescriptorHash,
		item.DescriptorVer,
		item.CapsetMethod.ID,
	}, "\x00")
}

func writeConnectLookupError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, domain.ErrMethodNotUnary) {
		connect.NewErrorWriter().Write(w, r, connect.NewError(connect.CodeUnimplemented, errors.New("method is not a unary service method")))
		return
	}
	connect.NewErrorWriter().Write(w, r, connect.NewError(connect.CodeNotFound, errors.New("method is not exposed by capset")))
}

func connectLookupErrorCode(err error) codes.Code {
	if errors.Is(err, domain.ErrMethodNotUnary) {
		return codes.Unimplemented
	}
	return codes.NotFound
}

func grpcStatusToConnectError(err error) error {
	st, ok := status.FromError(err)
	if !ok {
		return connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewError(connectCodeFromGRPC(st.Code()), errors.New(st.Message()))
}

func connectCodeFromGRPC(code codes.Code) connect.Code {
	switch code {
	case codes.Canceled:
		return connect.CodeCanceled
	case codes.Unknown:
		return connect.CodeUnknown
	case codes.InvalidArgument:
		return connect.CodeInvalidArgument
	case codes.DeadlineExceeded:
		return connect.CodeDeadlineExceeded
	case codes.NotFound:
		return connect.CodeNotFound
	case codes.AlreadyExists:
		return connect.CodeAlreadyExists
	case codes.PermissionDenied:
		return connect.CodePermissionDenied
	case codes.ResourceExhausted:
		return connect.CodeResourceExhausted
	case codes.FailedPrecondition:
		return connect.CodeFailedPrecondition
	case codes.Aborted:
		return connect.CodeAborted
	case codes.OutOfRange:
		return connect.CodeOutOfRange
	case codes.Unimplemented:
		return connect.CodeUnimplemented
	case codes.Internal:
		return connect.CodeInternal
	case codes.Unavailable:
		return connect.CodeUnavailable
	case codes.DataLoss:
		return connect.CodeDataLoss
	case codes.Unauthenticated:
		return connect.CodeUnauthenticated
	default:
		return connect.CodeUnknown
	}
}

func echoErrorStatus(err error) int {
	var sc echo.HTTPStatusCoder
	if errors.As(err, &sc) {
		return sc.StatusCode()
	}
	return http.StatusInternalServerError
}

func (g *Gateway) invokeJSON(ctx context.Context, item store.ExposedMethod, body io.Reader) ([]byte, error) {
	set, err := descriptors.Load(item.Service.DescriptorPath)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "descriptor load failed: %v", err)
	}
	files, err := protodesc.NewFiles(set)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "descriptor load failed: %v", err)
	}
	reqDesc, err := findMessage(files, item.Method.InputFullName)
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}
	reqMsg := dynamicpb.NewMessage(reqDesc)
	raw, err := io.ReadAll(body)
	if err != nil {
		if isRequestTooLarge(err) {
			return nil, status.Error(codes.ResourceExhausted, "request body too large")
		}
		return nil, status.Error(codes.InvalidArgument, err.Error())
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		raw = []byte(`{}`)
	}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(raw, reqMsg); err != nil {
		return nil, status.Error(codes.InvalidArgument, err.Error())
	}
	respRaw, err := g.invokeRaw(ctx, item, mustMarshal(reqMsg))
	if err != nil {
		return nil, err
	}
	respDesc, err := findMessage(files, item.Method.OutputFullName)
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}
	respMsg := dynamicpb.NewMessage(respDesc)
	if err := proto.Unmarshal(respRaw, respMsg); err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}
	return (protojson.MarshalOptions{UseProtoNames: false, EmitUnpopulated: false}).Marshal(respMsg)
}

func isRequestTooLarge(err error) bool {
	var maxBytesErr *http.MaxBytesError
	return errors.As(err, &maxBytesErr)
}

func requestBodyTooLarge(r *http.Request) bool {
	return r.ContentLength > DefaultMaxRequestBytes
}

func (g *Gateway) authorizeHTTP(r *http.Request, capsetID string) error {
	return authorizeCapsetBearer(r.Context(), g.Store, capsetID, bearerToken(r.Header.Get("Authorization")))
}

func (g *Gateway) authorizeMetadata(ctx context.Context, capsetID string) error {
	md, _ := metadata.FromIncomingContext(ctx)
	return authorizeCapsetBearer(ctx, g.Store, capsetID, bearerToken(firstMD(md, "authorization")))
}

func authorizeCapsetBearer(ctx context.Context, st *store.Store, capsetID, token string) error {
	required, err := st.CapsetRequiresToken(ctx, capsetID)
	if err != nil {
		return status.Error(codes.Internal, err.Error())
	}
	if !required {
		return nil
	}
	ok, err := st.VerifyCapsetToken(ctx, capsetID, token)
	if err != nil {
		return status.Error(codes.Internal, err.Error())
	}
	if !ok {
		return status.Error(codes.Unauthenticated, "capset token is required")
	}
	return nil
}

func bearerToken(value string) string {
	scheme, token, ok := strings.Cut(strings.TrimSpace(value), " ")
	if !ok || !strings.EqualFold(scheme, "bearer") {
		return ""
	}
	return strings.TrimSpace(token)
}

func (g *Gateway) invokeRaw(ctx context.Context, item store.ExposedMethod, req []byte) ([]byte, error) {
	if item.Service.RuntimeMode == domain.RuntimeModeOnDemand {
		if !item.Method.Unary {
			return nil, status.Error(codes.Unimplemented, "streaming methods are not supported by on-demand runtime")
		}
		return g.invokeOnDemand(ctx, item, req)
	}
	if item.Instance.ListenAddr == "" || string(item.Instance.Status) != "running" {
		return nil, status.Error(codes.Unavailable, "backend instance is not running")
	}
	if strings.HasPrefix(item.Instance.ListenAddr, "bufconn:") {
		return nil, status.Error(codes.Unavailable, "backend instance uses unsupported in-memory listener")
	}
	ctx, cancel := context.WithTimeout(ctx, backendUnaryTimeout())
	defer cancel()
	conn, err := g.backendConn(item)
	if err != nil {
		return nil, status.Error(codes.Unavailable, err.Error())
	}
	out := newRawFrame(nil)
	cleanCtx := metadata.NewOutgoingContext(metadata.NewIncomingContext(ctx, nil), stripOctobusMetadata(ctx))
	if err := conn.Invoke(cleanCtx, "/"+item.Method.FullName, newRawFrame(req), out); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func backendUnaryTimeout() time.Duration {
	raw := strings.TrimSpace(os.Getenv("OCTOBUS_BACKEND_UNARY_TIMEOUT"))
	if raw == "" {
		return 30 * time.Second
	}
	timeout, err := time.ParseDuration(raw)
	if err != nil || timeout <= 0 {
		return 30 * time.Second
	}
	return timeout
}

func (g *Gateway) newBackendStream(ctx context.Context, item store.ExposedMethod) (grpc.ClientStream, error) {
	if item.Service.RuntimeMode == domain.RuntimeModeOnDemand {
		return nil, status.Error(codes.Unimplemented, "streaming methods are not supported by on-demand runtime")
	}
	if item.Instance.ListenAddr == "" || string(item.Instance.Status) != "running" {
		return nil, status.Error(codes.Unavailable, "backend instance is not running")
	}
	if strings.HasPrefix(item.Instance.ListenAddr, "bufconn:") {
		return nil, status.Error(codes.Unavailable, "backend instance uses unsupported in-memory listener")
	}
	conn, err := g.backendConn(item)
	if err != nil {
		return nil, status.Error(codes.Unavailable, err.Error())
	}
	desc := &grpc.StreamDesc{
		StreamName:    item.Method.FullName,
		ServerStreams: item.Method.ServerStreaming,
		ClientStreams: item.Method.ClientStreaming,
	}
	cleanCtx := metadata.NewOutgoingContext(metadata.NewIncomingContext(ctx, nil), stripOctobusMetadata(ctx))
	return conn.NewStream(cleanCtx, desc, "/"+item.Method.FullName)
}

func (g *Gateway) invokeOnDemand(ctx context.Context, item store.ExposedMethod, req []byte) ([]byte, error) {
	if string(item.Instance.Status) != "running" || !item.Instance.Enabled {
		return nil, status.Error(codes.Unavailable, "backend instance is not running")
	}
	dataDir := g.DataDir
	if dataDir == "" {
		return nil, status.Error(codes.Internal, "gateway data dir is not configured")
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	workdir := filepath.Join(dataDir, "instances", item.Instance.ID)
	tmpParent := filepath.Join(workdir, "tmp")
	if err := os.MkdirAll(tmpParent, 0o700); err != nil {
		return nil, status.Errorf(codes.Internal, "create invoke temp parent: %v", err)
	}
	tmpDir, err := os.MkdirTemp(tmpParent, "invoke-")
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create invoke temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	metadataPath := filepath.Join(tmpDir, "metadata.json")
	metadataBytes, err := json.Marshal(metadataToJSON(stripOctobusMetadata(ctx)))
	if err != nil {
		return nil, status.Errorf(codes.Internal, "marshal invoke metadata: %v", err)
	}
	if err := os.WriteFile(metadataPath, metadataBytes, 0o600); err != nil {
		return nil, status.Errorf(codes.Internal, "write invoke metadata: %v", err)
	}
	inst, err := g.Store.GetInstance(ctx, item.Instance.ID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "load instance secret: %v", err)
	}

	entry := filepath.Join(dataDir, "artifacts", "services", item.Service.ID, "runtime", item.Service.NodeEntry)
	info, err := os.Stat(entry)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "runtime entry %q is not available: %v", item.Service.NodeEntry, err)
	}
	if !info.Mode().IsRegular() {
		return nil, status.Errorf(codes.Internal, "runtime entry %q is not a regular file", item.Service.NodeEntry)
	}
	secretFile, closeSecret, err := secretReadFile(inst.SecretJSON)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "prepare secret fd: %v", err)
	}
	defer closeSecret()
	cmd := exec.CommandContext(ctx, entry,
		"--runtime",
		"invoke",
		"--method", item.Method.FullName,
		"--config", filepath.Join(workdir, "config.json"),
		"--secret-fd", "3",
		"--metadata", metadataPath,
		"--workdir", workdir,
		"--service", item.Service.ID,
		"--instance", item.Instance.ID,
	)
	cmd.Dir = workdir
	cmd.ExtraFiles = []*os.File{secretFile}
	cmd.Env = append(os.Environ(),
		"OCTOBUS_SERVICE_ID="+item.Service.ID,
		"OCTOBUS_INSTANCE_ID="+item.Instance.ID,
		"OCTOBUS_PACKAGE_DIR="+filepath.Join(dataDir, "artifacts", "services", item.Service.ID, "runtime", filepath.FromSlash(item.Service.ServiceRoot)),
		"OCTOBUS_DESCRIPTOR_PATH="+item.Service.DescriptorPath,
		"OCTOBUS_DESCRIPTOR_SHA256="+item.Service.DescriptorSHA256,
	)
	cmd.Stdin = bytes.NewReader(req)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err = cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		return nil, status.Error(codes.DeadlineExceeded, "on-demand invoke timed out")
	}
	if err != nil {
		return nil, onDemandProcessError(err, stderr.String())
	}
	if err := g.validateOnDemandResponse(item, stdout.Bytes()); err != nil {
		return nil, err
	}
	return stdout.Bytes(), nil
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

func (g *Gateway) validateOnDemandResponse(item store.ExposedMethod, raw []byte) error {
	set, err := descriptors.Load(item.Service.DescriptorPath)
	if err != nil {
		return status.Errorf(codes.Internal, "descriptor load failed: %v", err)
	}
	files, err := protodesc.NewFiles(set)
	if err != nil {
		return status.Errorf(codes.Internal, "descriptor load failed: %v", err)
	}
	respDesc, err := findMessage(files, item.Method.OutputFullName)
	if err != nil {
		return status.Error(codes.Internal, err.Error())
	}
	respMsg := dynamicpb.NewMessage(respDesc)
	if err := proto.Unmarshal(raw, respMsg); err != nil {
		return status.Errorf(codes.Internal, "on-demand response is not valid protobuf: %v", err)
	}
	return nil
}

func metadataToJSON(md metadata.MD) map[string][]string {
	out := make(map[string][]string, len(md))
	for key, vals := range md {
		out[key] = append([]string(nil), vals...)
	}
	return out
}

func onDemandProcessError(err error, stderrText string) error {
	if code, message, ok := parseOctobusError(stderrText); ok {
		return status.Error(code, message)
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return status.Error(codes.Internal, strings.TrimSpace(stderrText))
	}
	return status.Error(codes.Unavailable, err.Error())
}

func parseOctobusError(stderrText string) (codes.Code, string, bool) {
	lines := strings.Split(strings.TrimRight(stderrText, "\r\n"), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line == "" || line == "program not built with -cover" || strings.HasPrefix(line, "warning: GOCOVERDIR not set") {
			continue
		}
		const prefix = "OCTOBUS_ERROR:"
		if !strings.HasPrefix(line, prefix) {
			return codes.OK, "", false
		}
		var payload struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		if err := json.Unmarshal([]byte(strings.TrimPrefix(line, prefix)), &payload); err != nil {
			return codes.OK, "", false
		}
		code, ok := grpcCodeByName(payload.Code)
		if !ok {
			return codes.OK, "", false
		}
		return code, payload.Message, true
	}
	return codes.OK, "", false
}

func grpcCodeByName(name string) (codes.Code, bool) {
	switch name {
	case "OK":
		return codes.OK, true
	case "CANCELLED":
		return codes.Canceled, true
	case "UNKNOWN":
		return codes.Unknown, true
	case "INVALID_ARGUMENT":
		return codes.InvalidArgument, true
	case "DEADLINE_EXCEEDED":
		return codes.DeadlineExceeded, true
	case "NOT_FOUND":
		return codes.NotFound, true
	case "ALREADY_EXISTS":
		return codes.AlreadyExists, true
	case "PERMISSION_DENIED":
		return codes.PermissionDenied, true
	case "RESOURCE_EXHAUSTED":
		return codes.ResourceExhausted, true
	case "FAILED_PRECONDITION":
		return codes.FailedPrecondition, true
	case "ABORTED":
		return codes.Aborted, true
	case "OUT_OF_RANGE":
		return codes.OutOfRange, true
	case "UNIMPLEMENTED":
		return codes.Unimplemented, true
	case "INTERNAL":
		return codes.Internal, true
	case "UNAVAILABLE":
		return codes.Unavailable, true
	case "DATA_LOSS":
		return codes.DataLoss, true
	case "UNAUTHENTICATED":
		return codes.Unauthenticated, true
	default:
		return codes.OK, false
	}
}

func (g *Gateway) backendConn(item store.ExposedMethod) (*grpc.ClientConn, error) {
	key := item.Instance.ID + "\x00" + item.Instance.ListenAddr
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.conns == nil {
		g.conns = map[string]*grpc.ClientConn{}
	}
	if conn := g.conns[key]; conn != nil {
		return conn, nil
	}
	for cachedKey, conn := range g.conns {
		id, _, _ := strings.Cut(cachedKey, "\x00")
		if id != item.Instance.ID {
			continue
		}
		_ = conn.Close()
		delete(g.conns, cachedKey)
	}
	conn, err := grpc.NewClient(item.Instance.ListenAddr, grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithDefaultCallOptions(grpc.ForceCodec(rawCodec{})))
	if err != nil {
		return nil, err
	}
	g.conns[key] = conn
	return conn, nil
}

func (g *Gateway) InvalidateInstance(instanceID string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	for key, conn := range g.conns {
		id, _, _ := strings.Cut(key, "\x00")
		if id != instanceID {
			continue
		}
		_ = conn.Close()
		delete(g.conns, key)
	}
}

func (g *Gateway) Close() error {
	g.mu.Lock()
	defer g.mu.Unlock()
	var err error
	for key, conn := range g.conns {
		if closeErr := conn.Close(); closeErr != nil && err == nil {
			err = closeErr
		}
		delete(g.conns, key)
	}
	return err
}

func LoadServiceDescriptorSet(path string) (*descriptorpb.FileDescriptorSet, error) {
	return descriptors.Load(path)
}

func DescriptorBytesForCatalog(ctx context.Context, st *store.Store, capsetID string) ([][]byte, error) {
	items, err := st.ListExposedMethods(ctx, capsetID)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, sql.ErrNoRows
	}
	seen := map[string]bool{}
	var out [][]byte
	for _, item := range items {
		if seen[item.Service.DescriptorPath] {
			continue
		}
		seen[item.Service.DescriptorPath] = true
		set, err := descriptors.Load(item.Service.DescriptorPath)
		if err != nil {
			return nil, err
		}
		for _, file := range set.GetFile() {
			b, err := proto.Marshal(file)
			if err != nil {
				return nil, err
			}
			out = append(out, b)
		}
	}
	return out, nil
}

func findMessage(files *protoregistry.Files, fullName string) (protoreflect.MessageDescriptor, error) {
	desc, err := files.FindDescriptorByName(protoreflect.FullName(fullName))
	if err != nil {
		return nil, err
	}
	msg, ok := desc.(protoreflect.MessageDescriptor)
	if !ok {
		return nil, fmt.Errorf("%s is not a message", fullName)
	}
	return msg, nil
}

func mustMarshal(msg proto.Message) []byte {
	b, err := proto.Marshal(msg)
	if err != nil {
		panic(err)
	}
	return b
}

func firstMD(md metadata.MD, key string) string {
	vals := md.Get(key)
	if len(vals) == 0 {
		return ""
	}
	return vals[0]
}

func stripOctobusMetadata(ctx context.Context) metadata.MD {
	in, _ := metadata.FromIncomingContext(ctx)
	out := metadata.MD{}
	for k, vals := range in {
		if isOctobusControlMetadata(k) {
			continue
		}
		out[k] = vals
	}
	return out
}

func isOctobusControlMetadata(key string) bool {
	normalized := strings.ToLower(key)
	return strings.HasPrefix(normalized, "x-octobus-") && !strings.HasPrefix(normalized, "x-octobus-ext-")
}

func connectForwardMetadata(headers http.Header) metadata.MD {
	out := metadata.MD{}
	for key, vals := range headers {
		normalized := strings.ToLower(key)
		if !isAllowedConnectForwardHeader(normalized) {
			continue
		}
		for _, val := range vals {
			out.Append(normalized, val)
		}
	}
	return out
}

func isAllowedConnectForwardHeader(key string) bool {
	return key == "x-business-request-id" || strings.HasPrefix(key, "x-octobus-ext-")
}

type rawFrame []byte

func newRawFrame(b []byte) *rawFrame { f := rawFrame(b); return &f }
func (f *rawFrame) Reset()           { *f = (*f)[:0] }
func (f *rawFrame) String() string   { return base64.StdEncoding.EncodeToString(*f) }
func (f *rawFrame) ProtoMessage()    {}
func (f *rawFrame) Bytes() []byte    { return []byte(*f) }

func mcpToolError(id any, code codes.Code, msg string) map[string]any {
	errObj := map[string]any{"error": map[string]any{"code": publicCode(code), "message": msg, "details": map[string]any{}}}
	b, _ := json.Marshal(errObj)
	return map[string]any{"jsonrpc": "2.0", "id": id, "result": map[string]any{"structuredContent": errObj, "content": []map[string]any{{"type": "text", "text": string(b)}}}}
}

func publicCode(code codes.Code) string {
	switch code {
	case codes.OK:
		return "OK"
	case codes.Canceled:
		return "CANCELLED"
	case codes.Unknown:
		return "UNKNOWN"
	case codes.InvalidArgument:
		return "INVALID_ARGUMENT"
	case codes.DeadlineExceeded:
		return "DEADLINE_EXCEEDED"
	case codes.NotFound:
		return "NOT_FOUND"
	case codes.AlreadyExists:
		return "ALREADY_EXISTS"
	case codes.PermissionDenied:
		return "PERMISSION_DENIED"
	case codes.ResourceExhausted:
		return "RESOURCE_EXHAUSTED"
	case codes.FailedPrecondition:
		return "FAILED_PRECONDITION"
	case codes.Aborted:
		return "ABORTED"
	case codes.OutOfRange:
		return "OUT_OF_RANGE"
	case codes.Unimplemented:
		return "UNIMPLEMENTED"
	case codes.Internal:
		return "INTERNAL"
	case codes.Unavailable:
		return "UNAVAILABLE"
	case codes.DataLoss:
		return "DATA_LOSS"
	case codes.Unauthenticated:
		return "UNAUTHENTICATED"
	default:
		return strings.ToUpper(code.String())
	}
}

func mcpProtocolError(id any, msg string) map[string]any {
	return map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": -32600, "message": msg}}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

var _ = errors.Is
var _ encoding.Codec = rawCodec{}

type strictProtoJSONCodec struct {
	name string
}

func (c strictProtoJSONCodec) Name() string {
	return c.name
}

func (strictProtoJSONCodec) Marshal(v any) ([]byte, error) {
	msg, ok := v.(proto.Message)
	if !ok {
		return nil, fmt.Errorf("not a proto message: %T", v)
	}
	return (protojson.MarshalOptions{UseProtoNames: false, EmitUnpopulated: false}).Marshal(msg)
}

func (strictProtoJSONCodec) Unmarshal(data []byte, v any) error {
	msg, ok := v.(proto.Message)
	if !ok {
		return fmt.Errorf("not a proto message: %T", v)
	}
	if len(bytes.TrimSpace(data)) == 0 {
		data = []byte(`{}`)
	}
	return (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(data, msg)
}

type rawCodec struct{}

func (rawCodec) Name() string { return "proto" }
func (rawCodec) Marshal(v any) ([]byte, error) {
	switch x := v.(type) {
	case *rawFrame:
		return x.Bytes(), nil
	case rawFrame:
		return []byte(x), nil
	case proto.Message:
		return proto.Marshal(x)
	default:
		return nil, fmt.Errorf("unsupported raw marshal type %T", v)
	}
}
func (rawCodec) Unmarshal(data []byte, v any) error {
	switch x := v.(type) {
	case *rawFrame:
		*x = append((*x)[:0], data...)
		return nil
	case proto.Message:
		return proto.Unmarshal(data, x)
	default:
		return fmt.Errorf("unsupported raw unmarshal type %T", v)
	}
}
