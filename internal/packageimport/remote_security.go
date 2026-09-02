package packageimport

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const remoteImportTimeout = 10 * time.Minute

var forbiddenRemoteNetworks = mustParseRemoteNetworks(
	"0.0.0.0/8",
	"10.0.0.0/8",
	"100.64.0.0/10",
	"127.0.0.0/8",
	"169.254.0.0/16",
	"172.16.0.0/12",
	"192.0.0.0/24",
	"192.0.2.0/24",
	"192.168.0.0/16",
	"198.18.0.0/15",
	"198.51.100.0/24",
	"203.0.113.0/24",
	"224.0.0.0/4",
	"240.0.0.0/4",
	"::/128",
	"::1/128",
	"fc00::/7",
	"fe80::/10",
	"ff00::/8",
	"2001:db8::/32",
)

func mustParseRemoteNetworks(cidrs ...string) []*net.IPNet {
	networks := make([]*net.IPNet, 0, len(cidrs))
	for _, cidr := range cidrs {
		_, network, err := net.ParseCIDR(cidr)
		if err != nil {
			panic(err)
		}
		networks = append(networks, network)
	}
	return networks
}

func DefaultRemoteTargetValidator(ctx context.Context, raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("invalid remote URL: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return errors.New("only HTTP(S) remote targets are allowed")
	}
	if u.Hostname() == "" {
		return errors.New("remote URL host is required")
	}
	return validateRemoteHost(ctx, u.Hostname())
}

func validateRemoteHost(ctx context.Context, hostname string) error {
	if ip := net.ParseIP(hostname); ip != nil {
		if isForbiddenRemoteIP(ip) {
			return fmt.Errorf("remote target %q resolves to a private or special address", hostname)
		}
		return nil
	}

	ips, err := net.DefaultResolver.LookupIPAddr(ctx, hostname)
	if err != nil {
		return fmt.Errorf("resolve remote target %q: %w", hostname, err)
	}
	if len(ips) == 0 {
		return fmt.Errorf("remote target %q has no address", hostname)
	}
	for _, item := range ips {
		if isForbiddenRemoteIP(item.IP) {
			return fmt.Errorf("remote target %q resolves to a private or special address", hostname)
		}
	}
	return nil
}

func isForbiddenRemoteIP(ip net.IP) bool {
	if ip == nil || !ip.IsGlobalUnicast() {
		return true
	}
	for _, network := range forbiddenRemoteNetworks {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

func newRemoteHTTPClient(validate func(context.Context, string) error) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	client := &http.Client{
		Transport: transport,
		Timeout:   remoteImportTimeout,
	}
	if validate == nil {
		return client
	}
	// Do not let HTTP(S)_PROXY redirect a validated request to an
	// unvalidated destination through an external proxy.
	transport.Proxy = nil
	transport.DialContext = safeRemoteDialContext(validate)
	client.CheckRedirect = func(req *http.Request, _ []*http.Request) error {
		return validate(req.Context(), req.URL.String())
	}
	return client
}

func safeRemoteDialContext(validate func(context.Context, string) error) func(context.Context, string, string) (net.Conn, error) {
	dialer := &net.Dialer{}
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		if err := validate(ctx, "https://"+net.JoinHostPort(host, port)); err != nil {
			return nil, err
		}

		ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, err
		}
		for _, item := range ips {
			if isForbiddenRemoteIP(item.IP) {
				continue
			}
			conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(item.IP.String(), port))
			if err == nil {
				return conn, nil
			}
		}
		return nil, fmt.Errorf("unable to connect to allowed address for %s", host)
	}
}

// validatedGitProxy forces the git subprocess to use the target policy while
// retaining the original hostname for HTTPS certificate verification.
type validatedGitProxy struct {
	listener  net.Listener
	ctx       context.Context
	validate  func(context.Context, string) error
	done      chan struct{}
	closeOnce sync.Once
}

func startValidatedGitProxy(ctx context.Context, validate func(context.Context, string) error) (*validatedGitProxy, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	proxy := &validatedGitProxy{listener: listener, ctx: ctx, validate: validate, done: make(chan struct{})}
	go proxy.serve()
	return proxy, nil
}

func (p *validatedGitProxy) URL() string {
	return "http://" + p.listener.Addr().String()
}

func (p *validatedGitProxy) serve() {
	defer close(p.done)
	go func() {
		select {
		case <-p.ctx.Done():
			_ = p.listener.Close()
		case <-p.done:
		}
	}()
	for {
		conn, err := p.listener.Accept()
		if err != nil {
			return
		}
		go p.handle(conn)
	}
}

func (p *validatedGitProxy) handle(client net.Conn) {
	defer client.Close()
	reader := bufio.NewReader(client)
	request, err := http.ReadRequest(reader)
	if err != nil || request.Method != http.MethodConnect {
		_, _ = io.WriteString(client, "HTTP/1.1 405 Method Not Allowed\\r\\nConnection: close\\r\\n\\r\\n")
		return
	}
	remote, err := dialValidatedRemote(p.ctx, request.Host, p.validate)
	if err != nil {
		_, _ = io.WriteString(client, "HTTP/1.1 403 Forbidden\\r\\nConnection: close\\r\\n\\r\\n")
		return
	}
	defer remote.Close()
	if _, err := io.WriteString(client, "HTTP/1.1 200 Connection Established\\r\\n\\r\\n"); err != nil {
		return
	}
	go func() {
		_, _ = io.Copy(remote, io.MultiReader(reader, client))
		_ = remote.Close()
	}()
	_, _ = io.Copy(client, remote)
}

func (p *validatedGitProxy) Close() error {
	var err error
	p.closeOnce.Do(func() { err = p.listener.Close() })
	<-p.done
	return err
}

func dialValidatedRemote(ctx context.Context, address string, validate func(context.Context, string) error) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	if validate == nil {
		validate = DefaultRemoteTargetValidator
	}
	if err := validate(ctx, "https://"+net.JoinHostPort(host, port)); err != nil {
		return nil, err
	}
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	dialer := &net.Dialer{}
	for _, item := range ips {
		if isForbiddenRemoteIP(item.IP) {
			continue
		}
		conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(item.IP.String(), port))
		if err == nil {
			return conn, nil
		}
	}
	return nil, fmt.Errorf("unable to connect to allowed address for %s", host)
}

func downloadRemoteArchive(ctx context.Context, source, artifactPath string, validate func(context.Context, string) error) error {
	if validate != nil {
		if err := validate(ctx, source); err != nil {
			return fmt.Errorf("validate remote package target: %w", err)
		}
	}
	ctx, cancel := context.WithTimeout(ctx, remoteImportTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
	if err != nil {
		return fmt.Errorf("download remote package %q: %w", redactedRemoteArchiveSource(source), err)
	}
	resp, err := newRemoteHTTPClient(validate).Do(req)
	if err != nil {
		return fmt.Errorf("download remote package %q: %w", redactedRemoteArchiveSource(source), err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("download remote package %q: HTTP %d", redactedRemoteArchiveSource(source), resp.StatusCode)
	}
	if err := os.MkdirAll(filepath.Dir(artifactPath), 0o755); err != nil {
		return err
	}
	out, err := os.OpenFile(artifactPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, resp.Body)
	closeErr := out.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}
