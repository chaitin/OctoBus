package protocol

import (
	"fmt"
	"net/http"
	"strings"

	"golang.org/x/net/http/httpguts"
)

// HTTPHeaderForwards contains validated HTTP-only forwarding rules. Its zero
// value leaves headers unchanged. Rules always read from the original headers.
type HTTPHeaderForwards struct {
	sourcesByTarget map[string]string
}

// ParseHTTPHeaderForwards accepts SOURCE=TARGET rules. Each target must be a
// unique x-octobus-ext-* header; names are case insensitive.
func ParseHTTPHeaderForwards(rules []string) (HTTPHeaderForwards, error) {
	parsed := HTTPHeaderForwards{sourcesByTarget: make(map[string]string)}
	for i, rule := range rules {
		source, target, ok := strings.Cut(rule, "=")
		source = strings.ToLower(strings.TrimSpace(source))
		target = strings.ToLower(strings.TrimSpace(target))
		if !ok || !httpguts.ValidHeaderFieldName(source) || !httpguts.ValidHeaderFieldName(target) {
			return HTTPHeaderForwards{}, fmt.Errorf("HTTP header forwarding rule %d must be SOURCE=TARGET with valid header names", i+1)
		}
		if !strings.HasPrefix(target, "x-octobus-ext-") || len(target) == len("x-octobus-ext-") {
			return HTTPHeaderForwards{}, fmt.Errorf("HTTP header forwarding rule %d target must be x-octobus-ext-*", i+1)
		}
		if _, exists := parsed.sourcesByTarget[target]; exists {
			return HTTPHeaderForwards{}, fmt.Errorf("HTTP header forwarding rule %d has a duplicate target", i+1)
		}
		parsed.sourcesByTarget[target] = source
	}
	return parsed, nil
}

func (f HTTPHeaderForwards) apply(headers http.Header) http.Header {
	if len(f.sourcesByTarget) == 0 {
		return headers
	}
	out := headers.Clone()
	for target, source := range f.sourcesByTarget {
		// Iterate to also handle noncanonical keys in programmatic requests.
		for key := range out {
			if strings.EqualFold(key, target) {
				delete(out, key)
			}
		}
		for key, values := range headers {
			if strings.EqualFold(key, source) {
				out[http.CanonicalHeaderKey(target)] = append(out[http.CanonicalHeaderKey(target)], values...)
			}
		}
	}
	return out
}
